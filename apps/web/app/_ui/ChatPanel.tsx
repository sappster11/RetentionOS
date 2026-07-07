'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Chat sidebar wired to /api/agent/chat (SSE). The client holds the live session in
// component state and re-sends it as {role, content} turns on every request; the server
// ALSO persists each exchange (agent_conversations / agent_messages via the engine), so
// past conversations are listable in the history drawer and reload via
// /api/v1/conversations. Tool calls stream back as action chips inline with the text.

type ChatPart =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; tool: string; summary: string; isError?: boolean }

interface ChatMessage {
  role: 'user' | 'assistant'
  parts: ChatPart[]
}

interface ConversationSummary {
  id: string
  title: string | null
  updated_at: string
}

/** Parse a persisted agent_messages row's content (jsonb parts array) into ChatParts. */
function partsOf(content: unknown): ChatPart[] {
  if (!Array.isArray(content)) return []
  const parts: ChatPart[] = []
  for (const p of content) {
    if (typeof p !== 'object' || p === null) continue
    const part = p as { kind?: unknown; text?: unknown; tool?: unknown; summary?: unknown; isError?: unknown }
    if (part.kind === 'text' && typeof part.text === 'string') {
      parts.push({ kind: 'text', text: part.text })
    } else if (part.kind === 'tool' && typeof part.tool === 'string') {
      parts.push({
        kind: 'tool',
        tool: part.tool,
        summary: typeof part.summary === 'string' ? part.summary : part.tool,
        isError: part.isError === true || undefined,
      })
    }
  }
  return parts
}

/** Flatten a message's text parts into the plain-string turn the API expects. */
function textOf(message: ChatMessage): string {
  return message.parts
    .filter((p): p is Extract<ChatPart, { kind: 'text' }> => p.kind === 'text')
    .map((p) => p.text)
    .join('')
}

export function ChatPanel({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  // null = probing on mount; true = no agent key (ANTHROPIC_API_KEY /
  // OPENROUTER_API_KEY) on the server.
  const [agentDisabled, setAgentDisabled] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Server-side conversation persistence: the active thread's id (null = a fresh thread,
  // created by the server on the first send) and the history drawer's contents.
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const refreshConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/conversations?limit=50')
      if (!res.ok) return
      const data = (await res.json()) as { conversations?: ConversationSummary[] }
      if (Array.isArray(data.conversations)) setConversations(data.conversations)
    } catch {
      // History is best-effort — the live chat works without it.
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/agent/chat')
      .then((r) => r.json())
      .then((d: { disabled?: boolean }) => {
        if (!cancelled) setAgentDisabled(Boolean(d.disabled))
      })
      .catch(() => {
        // Probe failed (offline dev server hiccup) — let a send attempt surface errors.
        if (!cancelled) setAgentDisabled(false)
      })
    // The history list is served by /api/v1 (no agent key needed), so load it either way.
    void refreshConversations()
    return () => {
      cancelled = true
    }
  }, [refreshConversations])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, busy])

  /** Load a past conversation's transcript into the panel. */
  const loadConversation = useCallback(
    async (id: string) => {
      if (busy) return
      try {
        const res = await fetch(`/api/v1/conversations/${id}`)
        if (!res.ok) {
          setError(`Couldn't load that conversation (${res.status}).`)
          return
        }
        const data = (await res.json()) as {
          messages?: Array<{ role?: string; content?: unknown }>
        }
        const loaded: ChatMessage[] = (data.messages ?? [])
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role as 'user' | 'assistant', parts: partsOf(m.content) }))
          .filter((m) => m.parts.length > 0)
        setMessages(loaded)
        setConversationId(id)
        setError(null)
        setDrawerOpen(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load conversation.')
      }
    },
    [busy],
  )

  /** Start a fresh thread — the server creates the conversation on the first send. */
  const newConversation = useCallback(() => {
    if (busy) return
    setMessages([])
    setConversationId(null)
    setError(null)
    setDrawerOpen(false)
  }, [busy])

  const deleteConversation = useCallback(
    async (id: string) => {
      if (busy) return
      if (!window.confirm('Delete this conversation? This cannot be undone.')) return
      try {
        const res = await fetch(`/api/v1/conversations/${id}`, { method: 'DELETE' })
        if (!res.ok) {
          setError(`Couldn't delete that conversation (${res.status}).`)
          return
        }
        setConversations((prev) => prev.filter((c) => c.id !== id))
        if (conversationId === id) {
          setMessages([])
          setConversationId(null)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete conversation.')
      }
    },
    [busy, conversationId],
  )

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || busy || agentDisabled !== false) return
    setError(null)
    setInput('')

    const userMessage: ChatMessage = { role: 'user', parts: [{ kind: 'text', text }] }
    const history = [...messages, userMessage]
    setMessages(history)
    setBusy(true)

    // Append parts to the assistant message currently being streamed.
    let assistantStarted = false
    const pushPart = (part: ChatPart) => {
      setMessages((prev) => {
        const next = [...prev]
        if (!assistantStarted) {
          assistantStarted = true
          next.push({ role: 'assistant', parts: [part] })
          return next
        }
        const last = next[next.length - 1]!
        const parts = [...last.parts]
        const tail = parts[parts.length - 1]
        if (part.kind === 'text' && tail && tail.kind === 'text') {
          parts[parts.length - 1] = { kind: 'text', text: tail.text + part.text }
        } else {
          parts.push(part)
        }
        next[next.length - 1] = { ...last, parts }
        return next
      })
    }

    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history
            .map((m) => ({ role: m.role, content: textOf(m) }))
            .filter((m) => m.content.trim() !== ''),
          ...(conversationId ? { conversationId } : {}),
        }),
      })

      const contentType = res.headers.get('content-type') ?? ''
      if (contentType.includes('application/json')) {
        const data = (await res.json()) as { disabled?: boolean; error?: string }
        if (data.disabled) {
          setAgentDisabled(true)
        } else {
          setError(data.error ?? `Request failed (${res.status}).`)
        }
        return
      }
      if (!res.ok || !res.body) {
        setError(`Request failed (${res.status}).`)
        return
      }

      // Parse the SSE stream: "data: {...}\n\n" frames.
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let boundary
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const line = frame.split('\n').find((l) => l.startsWith('data: '))
          if (!line) continue
          let event: {
            type: string
            text?: string
            tool?: string
            summary?: string
            isError?: boolean
            message?: string
            conversationId?: string
          }
          try {
            event = JSON.parse(line.slice(6))
          } catch {
            continue
          }
          if (event.type === 'conversation' && event.conversationId) {
            setConversationId(event.conversationId)
          } else if (event.type === 'text' && event.text) {
            pushPart({ kind: 'text', text: event.text })
          } else if (event.type === 'tool' && event.tool) {
            pushPart({
              kind: 'tool',
              tool: event.tool,
              summary: event.summary ?? event.tool,
              isError: event.isError,
            })
          } else if (event.type === 'error') {
            setError(event.message ?? 'The agent hit an error.')
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed.')
    } finally {
      setBusy(false)
      // The exchange was just persisted (and a new thread may have been auto-titled) —
      // refresh the history list so the drawer reflects it.
      void refreshConversations()
    }
  }, [input, busy, agentDisabled, messages, conversationId, refreshConversations])

  const canType = agentDisabled === false && !busy

  return (
    <aside
      style={{
        width: 'var(--chat-w)',
        flexShrink: 0,
        borderLeft: '1px solid var(--border)',
        background: 'var(--bg-subtle)',
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
      }}
    >
      <header
        style={{
          height: 44,
          flexShrink: 0,
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 14px',
          fontWeight: 600,
          fontSize: 13,
        }}
      >
        <span>Agent</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button
            onClick={newConversation}
            title="New conversation"
            style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', fontSize: 15, cursor: 'pointer', padding: '0 4px' }}
          >
            ＋
          </button>
          <button
            onClick={() => setDrawerOpen((v) => !v)}
            title="Conversation history"
            style={{
              border: 'none',
              background: 'transparent',
              color: drawerOpen ? 'var(--text)' : 'var(--text-muted)',
              fontSize: 13,
              cursor: 'pointer',
              padding: '0 4px',
            }}
          >
            🕘
          </button>
          <button
            onClick={onClose}
            title="Collapse"
            style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', fontSize: 16, cursor: 'pointer', padding: '0 4px' }}
          >
            ×
          </button>
        </div>
      </header>

      {drawerOpen && (
        <div
          style={{
            flexShrink: 0,
            maxHeight: '45vh',
            overflowY: 'auto',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg)',
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          <div
            style={{
              padding: '4px 6px',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-faint)',
              textTransform: 'uppercase',
              letterSpacing: 0.4,
            }}
          >
            Conversations
          </div>
          {conversations.length === 0 && (
            <div style={{ padding: '4px 6px 8px', fontSize: 12, color: 'var(--text-muted)' }}>
              No conversations yet.
            </div>
          )}
          {conversations.map((c) => (
            <div
              key={c.id}
              onClick={() => void loadConversation(c.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 6px',
                borderRadius: 'var(--radius)',
                cursor: busy ? 'default' : 'pointer',
                background: c.id === conversationId ? 'var(--accent-soft)' : 'transparent',
                border: `1px solid ${c.id === conversationId ? 'var(--border)' : 'transparent'}`,
              }}
            >
              <span
                style={{
                  flex: 1,
                  fontSize: 12.5,
                  color: 'var(--text)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {c.title ?? 'Untitled conversation'}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  void deleteConversation(c.id)
                }}
                title="Delete conversation"
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-faint)',
                  fontSize: 13,
                  cursor: 'pointer',
                  padding: '0 2px',
                  flexShrink: 0,
                }}
              >
                🗑
              </button>
            </div>
          ))}
        </div>
      )}

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {agentDisabled === true && (
          <div
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: 12,
              color: 'var(--text-muted)',
              fontSize: 12.5,
              lineHeight: 1.5,
            }}
          >
            <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
              Agent not configured
            </div>
            Set <code style={{ fontSize: 11.5 }}>ANTHROPIC_API_KEY</code> or{' '}
            <code style={{ fontSize: 11.5 }}>OPENROUTER_API_KEY</code> in Vercel → Settings →
            Environment Variables (or your local <code style={{ fontSize: 11.5 }}>.env</code>) to
            enable the agent. External agents already have full access via MCP.
          </div>
        )}

        {agentDisabled === false && messages.length === 0 && (
          <div
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: 12,
              color: 'var(--text-muted)',
              fontSize: 12.5,
              lineHeight: 1.5,
            }}
          >
            Ask the agent to inspect, build, or update this workspace — e.g. &quot;What tables do
            we have?&quot; or &quot;Add a Priority field to Tasks&quot;.
          </div>
        )}

        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div
              key={i}
              style={{
                alignSelf: 'flex-end',
                maxWidth: '88%',
                background: 'var(--accent-soft)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: '8px 10px',
                fontSize: 12.5,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
              }}
            >
              {textOf(m)}
            </div>
          ) : (
            <div
              key={i}
              style={{
                alignSelf: 'flex-start',
                maxWidth: '95%',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              {m.parts.map((part, j) =>
                part.kind === 'text' ? (
                  <div
                    key={j}
                    style={{
                      background: 'var(--bg)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      padding: '8px 10px',
                      fontSize: 12.5,
                      lineHeight: 1.5,
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {part.text}
                  </div>
                ) : (
                  <div
                    key={j}
                    title={part.tool}
                    style={{
                      alignSelf: 'flex-start',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      background: part.isError ? '#fdf2f2' : 'var(--bg-hover)',
                      border: `1px solid ${part.isError ? '#e8b4b4' : 'var(--border-strong)'}`,
                      borderRadius: 999,
                      padding: '3px 10px',
                      fontSize: 11.5,
                      color: part.isError ? '#9b2c2c' : 'var(--text-muted)',
                    }}
                  >
                    {part.summary}
                  </div>
                ),
              )}
            </div>
          ),
        )}

        {busy && (
          <div style={{ alignSelf: 'flex-start', color: 'var(--text-faint)', fontSize: 12 }}>
            Thinking…
          </div>
        )}

        {error && (
          <div
            style={{
              background: '#fdf2f2',
              border: '1px solid #e8b4b4',
              borderRadius: 'var(--radius)',
              padding: '8px 10px',
              color: '#9b2c2c',
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--border)', padding: 12 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            disabled={agentDisabled !== false}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            placeholder={
              agentDisabled === null
                ? 'Connecting…'
                : agentDisabled
                  ? 'Agent not configured'
                  : busy
                    ? 'Working…'
                    : 'Ask the agent…'
            }
            style={{
              flex: 1,
              padding: '8px 10px',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius)',
              background: agentDisabled === false ? 'var(--bg)' : 'var(--bg-hover)',
              color: agentDisabled === false ? 'var(--text)' : 'var(--text-faint)',
            }}
          />
          <button
            disabled={!canType || input.trim() === ''}
            onClick={() => void send()}
            style={{
              padding: '0 12px',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius)',
              background: canType && input.trim() !== '' ? 'var(--accent)' : 'var(--bg-hover)',
              color: canType && input.trim() !== '' ? '#fff' : 'var(--text-faint)',
              cursor: canType && input.trim() !== '' ? 'pointer' : 'not-allowed',
            }}
          >
            Send
          </button>
        </div>
      </div>
    </aside>
  )
}
