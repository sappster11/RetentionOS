// The chat route's persistence path, fully mocked (no database, no network): the
// Anthropic client is scripted, the engine's conversation store and the org resolution
// are stubbed, and the shared tool defs are replaced with one fake tool. Verifies that a
// send creates a conversation, emits {type:'conversation'} as the FIRST SSE frame, and
// appends the user turn + the final assistant message (text AND tool chips) in one batch.
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createConversation: vi.fn(),
  getConversation: vi.fn(),
  appendMessages: vi.fn(),
  toolRun: vi.fn(),
  // Queue of scripted model turns consumed by FakeAnthropic.messages.stream().
  turns: [] as Array<{ deltas: string[]; final: { stop_reason: string; content: unknown[] } }>,
}))

vi.mock('../lib/org', () => ({
  getCurrentOrg: vi.fn(async () => ({ id: 'org-1', name: 'Org', slug: 'org', created_at: '' })),
}))

vi.mock('@retentionos/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@retentionos/engine')>()
  return {
    ...actual,
    createConversation: mocks.createConversation,
    getConversation: mocks.getConversation,
    appendMessages: mocks.appendMessages,
  }
})

vi.mock('@retentionos/mcp-engine/tools', () => ({
  tools: [
    {
      name: 'list_tables',
      description: 'List tables',
      inputSchema: {},
      run: mocks.toolRun,
    },
  ],
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class FakeAnthropic {
    messages = {
      stream: () => {
        const turn = mocks.turns.shift()
        if (!turn) throw new Error('FakeAnthropic: no scripted turn left')
        let onText: ((delta: string) => void) | null = null
        return {
          on(event: string, cb: (delta: string) => void) {
            if (event === 'text') onText = cb
            return this
          },
          async finalMessage() {
            for (const d of turn.deltas) onText?.(d)
            return turn.final
          },
        }
      },
    }
  },
}))

import { EngineError } from '@retentionos/engine'
import { POST } from '../app/api/agent/chat/route'

function post(body: unknown): Request {
  return new Request('http://localhost/api/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Drain the SSE response into parsed event objects, in order. */
async function readEvents(res: Response): Promise<Array<Record<string, unknown>>> {
  const raw = await res.text()
  return raw
    .split('\n\n')
    .filter((f) => f.startsWith('data: '))
    .map((f) => JSON.parse(f.slice(6)) as Record<string, unknown>)
}

afterEach(() => {
  vi.unstubAllEnvs()
  mocks.createConversation.mockReset()
  mocks.getConversation.mockReset()
  mocks.appendMessages.mockReset()
  mocks.toolRun.mockReset()
  mocks.turns.length = 0
})

function scriptToolThenAnswer() {
  mocks.turns.push(
    {
      deltas: ['Checking.'],
      final: {
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Checking.' },
          { type: 'tool_use', id: 'toolu_1', name: 'list_tables', input: {} },
        ],
      },
    },
    {
      deltas: ['You have 0 tables.'],
      final: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'You have 0 tables.' }] },
    },
  )
  mocks.toolRun.mockResolvedValue({
    content: [{ type: 'text', text: JSON.stringify({ tables: [] }) }],
  })
}

describe('POST /api/agent/chat — conversation persistence', () => {
  it('creates a conversation when none is given, emits it first, and persists both turns', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    mocks.createConversation.mockResolvedValue({ id: 'conv-1', organization_id: 'org-1' })
    mocks.appendMessages.mockResolvedValue([])
    scriptToolThenAnswer()

    const res = await POST(post({ messages: [{ role: 'user', content: 'What tables do we have?' }] }))
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const events = await readEvents(res)

    // First frame: the conversation id; last frame: done.
    expect(events[0]).toEqual({ type: 'conversation', conversationId: 'conv-1' })
    expect(events[events.length - 1]).toEqual({ type: 'done' })
    expect(mocks.createConversation).toHaveBeenCalledWith('org-1')
    expect(mocks.getConversation).not.toHaveBeenCalled()

    // Both turns persisted in ONE batch, assistant content in the UI shape
    // (coalesced text, tool chip, follow-up text).
    expect(mocks.appendMessages).toHaveBeenCalledTimes(1)
    expect(mocks.appendMessages).toHaveBeenCalledWith('org-1', 'conv-1', [
      { role: 'user', content: [{ kind: 'text', text: 'What tables do we have?' }] },
      {
        role: 'assistant',
        content: [
          { kind: 'text', text: 'Checking.' },
          { kind: 'tool', tool: 'list_tables', summary: '📋 Listed tables — 0 tables' },
          { kind: 'text', text: 'You have 0 tables.' },
        ],
      },
    ])

    // The tool ran with the agent actor + resolved org pin (agent-parity law).
    expect(mocks.toolRun).toHaveBeenCalledWith(
      {},
      { actor: { type: 'agent', id: 'roam-chat' }, orgId: 'org-1' },
    )
  })

  it('reuses a provided conversationId after an ownership check (no create)', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    mocks.getConversation.mockResolvedValue({ conversation: { id: 'conv-9' }, messages: [] })
    mocks.appendMessages.mockResolvedValue([])
    mocks.turns.push({
      deltas: ['Hi again.'],
      final: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hi again.' }] },
    })

    const res = await POST(
      post({ messages: [{ role: 'user', content: 'hello again' }], conversationId: 'conv-9' }),
    )
    const events = await readEvents(res)

    expect(events[0]).toEqual({ type: 'conversation', conversationId: 'conv-9' })
    expect(mocks.getConversation).toHaveBeenCalledWith('org-1', 'conv-9')
    expect(mocks.createConversation).not.toHaveBeenCalled()
    expect(mocks.appendMessages).toHaveBeenCalledWith('org-1', 'conv-9', [
      { role: 'user', content: [{ kind: 'text', text: 'hello again' }] },
      { role: 'assistant', content: [{ kind: 'text', text: 'Hi again.' }] },
    ])
  })

  it('a bogus conversationId is a clean JSON 404 before any streaming', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    mocks.getConversation.mockRejectedValue(new EngineError('Conversation not found.', 'not_found'))

    const res = await POST(
      post({ messages: [{ role: 'user', content: 'hi' }], conversationId: 'nope' }),
    )
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ code: 'not_found' })
    expect(mocks.turns).toHaveLength(0) // never scripted, never consumed
    expect(mocks.appendMessages).not.toHaveBeenCalled()
  })

  it('rejects a non-string conversationId with 400 before any db work', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    const res = await POST(
      post({ messages: [{ role: 'user', content: 'hi' }], conversationId: 42 }),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'bad_input' })
    expect(mocks.createConversation).not.toHaveBeenCalled()
    expect(mocks.getConversation).not.toHaveBeenCalled()
  })

  it('a model error still persists the user turn (thread never loses the ask)', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    mocks.createConversation.mockResolvedValue({ id: 'conv-2', organization_id: 'org-1' })
    mocks.appendMessages.mockResolvedValue([])
    // No scripted turns → FakeAnthropic throws → the loop error path runs.

    const res = await POST(post({ messages: [{ role: 'user', content: 'boom' }] }))
    const events = await readEvents(res)
    expect(events[0]).toEqual({ type: 'conversation', conversationId: 'conv-2' })
    expect(events.some((e) => e.type === 'error')).toBe(true)
    expect(mocks.appendMessages).toHaveBeenCalledWith('org-1', 'conv-2', [
      { role: 'user', content: [{ kind: 'text', text: 'boom' }] },
    ])
  })
})
