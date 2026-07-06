// The in-app agent's tool-use loop: stream a model turn, execute any requested engine
// tools via the SHARED tool defs (@retentionos/mcp-engine/tools — agent-parity law),
// feed results back, repeat. Transport-agnostic: the caller supplies an emit() sink
// (the route turns events into SSE) and an Anthropic-shaped client (tests inject a mock).
import type { EngineToolDef, ToolResult, ToolRunContext } from '@retentionos/mcp-engine/tools'
import { toAnthropicTool } from './toolSchema'

// --- events streamed to the UI -----------------------------------------------------

export type AgentStreamEvent =
  | { type: 'text'; text: string } // assistant text delta
  | { type: 'tool'; tool: string; summary: string; isError?: boolean } // action chip
  | { type: 'error'; message: string }
  | { type: 'done' }

// --- minimal Anthropic client surface (structural, so tests can mock it) ------------

/** Loose structural view of an assistant content block — the SDK's ContentBlock union
 * (text / tool_use / thinking / ...) is assignable to this, and mocks can build it
 * without importing SDK types. */
export interface AssistantContentBlock {
  type: string
  text?: string
  id?: string
  name?: string
  input?: unknown
}

interface ToolUseBlock extends AssistantContentBlock {
  type: 'tool_use'
  id: string
  name: string
}

export interface FinalMessageLike {
  stop_reason: string | null
  content: AssistantContentBlock[]
}

export interface MessageStreamLike {
  on(event: 'text', listener: (delta: string) => void): unknown
  finalMessage(): Promise<FinalMessageLike>
}

/** Structural subset of `Anthropic` from @anthropic-ai/sdk — `client.messages.stream()`.
 * Method-parameter bivariance makes the real client assignable here. */
export interface AnthropicClientLike {
  messages: { stream(params: Record<string, unknown>): MessageStreamLike }
}

// --- loop ----------------------------------------------------------------------------

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: unknown
}

export interface RunAgentLoopOptions {
  client: AnthropicClientLike
  model: string
  system: string
  tools: EngineToolDef[]
  /** Conversation so far; first entry must be a user turn. */
  messages: ChatTurn[]
  /** Actor + org pin threaded into every tool handler (audit attribution). */
  toolContext: ToolRunContext
  /** Hard cap on model turns per request (default 12). */
  maxIterations?: number
  emit: (event: AgentStreamEvent) => void
  maxTokens?: number
  /** Abort signal (the route passes request.signal). Checked before every model call and
   * before every tool execution: once aborted, no further model calls or engine mutations
   * happen — the loop emits a best-effort final done and returns. */
  signal?: AbortSignal
}

export const MAX_TOOL_ITERATIONS = 12

export async function runAgentLoop(opts: RunAgentLoopOptions): Promise<void> {
  const anthropicTools = opts.tools.map(toAnthropicTool)
  const toolsByName = new Map(opts.tools.map((t) => [t.name, t]))
  const messages: ChatTurn[] = [...opts.messages]
  const maxIterations = opts.maxIterations ?? MAX_TOOL_ITERATIONS

  // Best-effort final event on abort: the client has usually disconnected, so the SSE
  // controller may already be closed — emitting must not turn a clean stop into a throw.
  const emitDoneOnAbort = () => {
    try {
      opts.emit({ type: 'done' })
    } catch {
      // stream already closed — nothing left to notify
    }
  }

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (opts.signal?.aborted) {
      emitDoneOnAbort()
      return
    }
    const stream = opts.client.messages.stream({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 8192,
      system: opts.system,
      tools: anthropicTools,
      // Snapshot: the loop mutates `messages` after the call, and the params object
      // should describe THIS request (also keeps mocks honest in tests).
      messages: [...messages],
    })
    stream.on('text', (delta) => opts.emit({ type: 'text', text: delta }))
    const message = await stream.finalMessage()

    messages.push({ role: 'assistant', content: message.content })

    // Server paused mid-turn (server-side tools) — just re-send to resume.
    if (message.stop_reason === 'pause_turn') continue

    const toolUses = message.content.filter(
      (b): b is ToolUseBlock =>
        b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string',
    )
    if (message.stop_reason !== 'tool_use' || toolUses.length === 0) {
      opts.emit({ type: 'done' })
      return
    }

    // Execute every requested tool, then return ALL results in ONE user turn.
    const results: Array<Record<string, unknown>> = []
    for (const use of toolUses) {
      // Aborted mid-turn (client gone): stop before the next tool — no further mutations.
      if (opts.signal?.aborted) {
        emitDoneOnAbort()
        return
      }
      const def = toolsByName.get(use.name)
      const result: ToolResult = def
        ? await def.run((use.input ?? {}) as Record<string, unknown>, opts.toolContext)
        : {
            isError: true,
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: { code: 'unknown_tool', message: `No such tool: ${use.name}` },
                }),
              },
            ],
          }
      opts.emit({
        type: 'tool',
        tool: use.name,
        summary: summarizeToolCall(use.name, use.input, result),
        isError: result.isError || undefined,
      })
      results.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: result.content[0]?.text ?? '',
        ...(result.isError ? { is_error: true } : {}),
      })
    }
    messages.push({ role: 'user', content: results })
  }

  opts.emit({
    type: 'text',
    text: '\n\n_Stopped: reached the tool-call limit for a single message. Ask me to continue._',
  })
  opts.emit({ type: 'done' })
}

// --- action-chip summaries -------------------------------------------------------------

/** Human-readable one-liner for the UI's action chips, e.g.
 * "📋 Queried Leads — 3 records" or "✏️ Updated record in Clients". Best-effort:
 * falls back to the tool name if the result doesn't parse. */
export function summarizeToolCall(name: string, input: unknown, result: ToolResult): string {
  const args = (input ?? {}) as Record<string, unknown>
  const table = typeof args.table === 'string' ? args.table : undefined
  let parsed: Record<string, unknown> = {}
  try {
    const text = result.content[0]?.text
    if (text) parsed = JSON.parse(text) as Record<string, unknown>
  } catch {
    // keep parsed empty — summaries below degrade gracefully
  }

  if (result.isError) {
    const err = parsed.error as { code?: string; message?: string } | undefined
    return `⚠️ ${name} failed${err?.code ? ` — ${err.code}` : ''}`
  }

  const count = (key: string): number | undefined => {
    const v = parsed[key]
    return Array.isArray(v) ? v.length : typeof v === 'number' ? v : undefined
  }
  const plural = (n: number | undefined, noun: string) =>
    n === undefined ? noun + 's' : `${n} ${noun}${n === 1 ? '' : 's'}`

  switch (name) {
    case 'list_tables':
      return `📋 Listed tables — ${plural(count('tables'), 'table')}`
    case 'describe_table':
      return `📋 Inspected ${table ?? 'table'}`
    case 'create_table':
      return `➕ Created table ${typeof args.name === 'string' ? args.name : ''}`.trim()
    case 'update_table':
      return `✏️ Updated table ${table ?? ''}`.trim()
    case 'delete_table':
      return `🗑️ Deleted table ${table ?? ''}`.trim()
    case 'create_field':
      return `➕ Added field ${typeof args.name === 'string' ? `"${args.name}" ` : ''}to ${table ?? 'table'}`
    case 'update_field':
      return `✏️ Updated field in ${table ?? 'table'}`
    case 'delete_field':
      return `🗑️ Deleted field from ${table ?? 'table'}`
    case 'query_records': {
      const records = count('records')
      const total = typeof parsed.total === 'number' ? parsed.total : undefined
      const suffix =
        records !== undefined && total !== undefined && total > records
          ? `${records} of ${total} records`
          : plural(records, 'record')
      return `📋 Queried ${table ?? 'records'} — ${suffix}`
    }
    case 'get_record':
      return `📋 Fetched record from ${table ?? 'table'}`
    case 'create_record':
      return `➕ Created record in ${table ?? 'table'}`
    case 'update_record':
      return `✏️ Updated record in ${table ?? 'table'}`
    case 'delete_records': {
      const n =
        typeof parsed.deleted === 'number'
          ? parsed.deleted
          : Array.isArray(args.record_ids)
            ? args.record_ids.length
            : undefined
      return `🗑️ Deleted ${plural(n, 'record')} from ${table ?? 'table'}`
    }
    case 'list_views':
      return `📋 Listed views on ${table ?? 'table'}`
    case 'create_view':
      return `➕ Created view ${typeof args.name === 'string' ? `"${args.name}" ` : ''}on ${table ?? 'table'}`
    case 'update_view':
      return `✏️ Updated view on ${table ?? 'table'}`
    case 'delete_view':
      return `🗑️ Deleted view from ${table ?? 'table'}`
    case 'list_revisions':
      return `🕘 Read revision history — ${plural(count('revisions'), 'revision')}`
    default:
      return `🔧 Ran ${name}`
  }
}
