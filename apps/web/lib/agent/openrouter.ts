// OpenRouter provider for the in-app agent — an OpenAI-compatible adapter that
// satisfies the loop's AnthropicClientLike seam (see ./loop.ts). The loop keeps
// speaking its native Anthropic-shaped protocol (content blocks, tool_use /
// tool_result turns); this adapter translates each model turn to the OpenAI
// chat-completions wire format (role:'tool' results, {type:'function'} tools,
// streamed tool_calls) and back. Plain fetch + SSE parsing — no openai SDK dep.
import type {
  AnthropicClientLike,
  AssistantContentBlock,
  FinalMessageLike,
  MessageStreamLike,
} from './loop'
import type { AnthropicToolParam } from './toolSchema'

/** Latest Claude Sonnet on OpenRouter — verified against
 * GET https://openrouter.ai/api/v1/models on 2026-07-06. */
export const OPENROUTER_DEFAULT_MODEL = 'anthropic/claude-sonnet-5'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

export interface OpenRouterClientOptions {
  apiKey: string
  /** Passed straight to fetch so an in-flight stream stops when the request is
   * cancelled. An abort mid-turn resolves to an empty end_turn (the loop then
   * finishes cleanly) instead of throwing. */
  signal?: AbortSignal
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch
}

/** Convert the loop's Anthropic-shaped request params to an OpenAI
 * chat-completions body (OpenRouter convention). */
function toOpenAiBody(params: Record<string, unknown>): Record<string, unknown> {
  const turns = (params.messages as Array<{ role: string; content: unknown }> | undefined) ?? []
  const tools = (params.tools as AnthropicToolParam[] | undefined) ?? []

  const messages: Array<Record<string, unknown>> = []
  if (typeof params.system === 'string' && params.system !== '') {
    messages.push({ role: 'system', content: params.system })
  }
  for (const turn of turns) {
    if (typeof turn.content === 'string') {
      messages.push({ role: turn.role, content: turn.content })
      continue
    }
    const blocks = Array.isArray(turn.content)
      ? (turn.content as Array<Record<string, unknown>>)
      : []
    if (turn.role === 'assistant') {
      // Assistant block list → one message: concatenated text + tool_calls.
      const text = blocks
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text as string)
        .join('')
      const toolCalls = blocks
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({
          id: String(b.id ?? ''),
          type: 'function',
          function: { name: String(b.name ?? ''), arguments: JSON.stringify(b.input ?? {}) },
        }))
      messages.push({
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      })
    } else {
      // User turn of tool_result blocks → one role:'tool' message per result.
      // (Plain-text user block lists don't occur in this loop.)
      for (const b of blocks) {
        if (b.type !== 'tool_result') continue
        messages.push({
          role: 'tool',
          tool_call_id: String(b.tool_use_id ?? ''),
          content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? ''),
        })
      }
    }
  }

  return {
    model: params.model,
    max_tokens: params.max_tokens,
    messages,
    ...(tools.length > 0
      ? {
          tools: tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.input_schema },
          })),
        }
      : {}),
    stream: true,
  }
}

interface StreamedToolCall {
  id: string
  name: string
  args: string
}

/** Parse the SSE response stream, forwarding text deltas and accumulating
 * tool_calls, then return the Anthropic-shaped final message. */
async function readSseStream(
  res: Response,
  onText: (delta: string) => void,
): Promise<FinalMessageLike> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  const toolCalls: StreamedToolCall[] = []
  let finishReason: string | null = null

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline: number
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, '')
      buffer = buffer.slice(newline + 1)
      // Ignores blank keep-alives and ": OPENROUTER PROCESSING" comment lines.
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6)
      if (payload === '[DONE]') continue
      let chunk: Record<string, unknown>
      try {
        chunk = JSON.parse(payload) as Record<string, unknown>
      } catch {
        continue // malformed frame — skip rather than kill the turn
      }
      const choice = (chunk.choices as Array<Record<string, unknown>> | undefined)?.[0]
      if (!choice) continue
      if (typeof choice.finish_reason === 'string') finishReason = choice.finish_reason
      const delta = choice.delta as
        | {
            content?: unknown
            tool_calls?: Array<{
              index?: number
              id?: string
              function?: { name?: string; arguments?: string }
            }>
          }
        | undefined
      if (typeof delta?.content === 'string' && delta.content !== '') {
        text += delta.content
        onText(delta.content)
      }
      for (const tc of delta?.tool_calls ?? []) {
        const index = typeof tc.index === 'number' ? tc.index : toolCalls.length
        const slot = (toolCalls[index] ??= { id: '', name: '', args: '' })
        if (tc.id) slot.id = tc.id
        if (tc.function?.name) slot.name = tc.function.name
        if (tc.function?.arguments) slot.args += tc.function.arguments
      }
    }
  }

  const content: AssistantContentBlock[] = []
  if (text !== '') content.push({ type: 'text', text })
  toolCalls.forEach((tc, i) => {
    if (!tc) return // sparse index from a misbehaving stream
    let input: unknown = {}
    try {
      input = tc.args ? (JSON.parse(tc.args) as unknown) : {}
    } catch {
      input = {} // unparseable args — let the tool's own validation report it
    }
    content.push({ type: 'tool_use', id: tc.id || `call_${i}`, name: tc.name, input })
  })

  // finish_reason → stop_reason: any tool call means tool_use (the loop's trigger);
  // 'stop' → end_turn; anything else passes through (the loop treats it as final).
  const stop_reason =
    content.some((b) => b.type === 'tool_use')
      ? 'tool_use'
      : finishReason === 'stop' || finishReason === null
        ? 'end_turn'
        : finishReason === 'length'
          ? 'max_tokens'
          : finishReason
  return { stop_reason, content }
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

/** OpenRouter client satisfying the loop's AnthropicClientLike provider seam. */
export function createOpenRouterClient(opts: OpenRouterClientOptions): AnthropicClientLike {
  const doFetch = opts.fetchImpl ?? fetch
  return {
    messages: {
      stream(params: Record<string, unknown>): MessageStreamLike {
        const listeners: Array<(delta: string) => void> = []
        return {
          on(_event: 'text', listener: (delta: string) => void) {
            listeners.push(listener)
            return this
          },
          async finalMessage(): Promise<FinalMessageLike> {
            try {
              const res = await doFetch(OPENROUTER_URL, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${opts.apiKey}`,
                  'Content-Type': 'application/json',
                  // OpenRouter attribution convention.
                  'HTTP-Referer': 'https://github.com/sappster11/RetentionOS',
                  'X-Title': 'RetentionOS',
                },
                body: JSON.stringify(toOpenAiBody(params)),
                signal: opts.signal,
              })
              if (!res.ok || !res.body) {
                throw new Error(`OpenRouter request failed (HTTP ${res.status}).`)
              }
              return await readSseStream(res, (delta) => {
                for (const l of listeners) l(delta)
              })
            } catch (err) {
              // Client cancelled mid-turn: resolve to an empty final turn so the
              // loop finishes cleanly instead of surfacing an error event.
              if (isAbortError(err) || opts.signal?.aborted) {
                return { stop_reason: 'end_turn', content: [] }
              }
              throw err
            }
          },
        }
      },
    },
  }
}
