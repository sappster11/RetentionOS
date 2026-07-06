// POST /api/agent/chat — the in-app Roam workspace agent (SSE streaming).
//
// Body: { messages: [{ role: 'user' | 'assistant', content: string }, ...] } — the
// CLIENT holds the session; nothing is persisted server-side in v1 (conversation
// persistence is a noted fast-follow). The response is an SSE stream of
// AgentStreamEvent JSON: text deltas, tool action chips ({tool, summary}), error, done.
//
// Provider selection (see lib/agent/provider.ts): ANTHROPIC_API_KEY → Anthropic SDK
// (first-class); else OPENROUTER_API_KEY → OpenRouter adapter (OpenAI-compatible,
// lib/agent/openrouter.ts). Keyless mode: when NEITHER key is set this returns 200
// {disabled: true} (GET too, so the panel can probe on mount) — the UI shows setup
// guidance instead of crashing. Model: ROS_AGENT_MODEL env, default "claude-sonnet-5"
// (Anthropic) / "anthropic/claude-sonnet-5" (OpenRouter).
//
// Tools are the SHARED engine tool defs from @retentionos/mcp-engine/tools (agent-parity
// law — same service layer as the UI, REST API, and MCP server). Handlers run with the
// {type:'agent', id:'roam-chat'} audit actor and the same org resolution the REST API
// uses (getCurrentOrg via resolveOrgId), passed as the per-call org pin.
import Anthropic from '@anthropic-ai/sdk'
import { tools } from '@retentionos/mcp-engine/tools'
import { errorResponse, json, readJson, resolveOrgId } from '@/lib/api'
import {
  runAgentLoop,
  type AgentStreamEvent,
  type AnthropicClientLike,
  type ChatTurn,
} from '@/lib/agent/loop'
import { createOpenRouterClient } from '@/lib/agent/openrouter'
import { chooseAgentProvider } from '@/lib/agent/provider'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SYSTEM_PROMPT = `You are the Roam workspace agent inside RetentionOS — an Airtable-class database where tables, fields, records, links, and views are runtime data. You operate the workspace through the provided tools (the same service layer the UI uses, so anything a human can click, you can call).

Operating rules:
- Always call describe_table before writing to a table you haven't inspected this conversation: record values are keyed by FIELD ID (uuid), select values use choice ids (not display names), percent values are 0-1 fractions, and computed fields (formula, lookup, rollup, autonumber, created_time, last_modified_time) are read-only.
- Destructive actions — delete_table, delete_field, or delete_records with more than one record — only when the user explicitly asked for that deletion. If they didn't, ask first instead of calling the tool.
- Keep answers short. After making changes, state exactly what changed (tables, fields, records, counts) based on tool results — never guess or overstate.
- If a tool returns an error, say what failed and what you'd need to fix it.`

/** Probe endpoint for the chat panel: is the agent configured? */
export async function GET() {
  return json({ disabled: chooseAgentProvider() === null })
}

/** Validate the client-held session shape. Returns null when invalid. */
function parseMessages(raw: unknown): ChatTurn[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const turns: ChatTurn[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) return null
    const { role, content } = entry as { role?: unknown; content?: unknown }
    if (role !== 'user' && role !== 'assistant') return null
    if (typeof content !== 'string' || content.trim() === '') return null
    turns.push({ role, content })
  }
  if (turns[0]!.role !== 'user') return null
  return turns
}

export async function POST(request: Request) {
  const config = chooseAgentProvider()
  if (!config) return json({ disabled: true })

  let messages: ChatTurn[] | null
  try {
    const body = await readJson(request)
    messages = parseMessages(body.messages)
  } catch (err) {
    return errorResponse(err)
  }
  if (!messages) {
    return json(
      {
        error:
          'Body must be { messages: [{ role: "user" | "assistant", content: string }, ...] } starting with a user turn.',
        code: 'bad_input',
      },
      400,
    )
  }

  let orgId: string
  try {
    orgId = await resolveOrgId()
  } catch (err) {
    return errorResponse(err)
  }

  const client: AnthropicClientLike =
    config.provider === 'anthropic'
      ? new Anthropic({ apiKey: config.apiKey })
      : createOpenRouterClient({ apiKey: config.apiKey, signal: request.signal })
  const model = config.model
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: AgentStreamEvent) => {
        // The client may have disconnected mid-stream (controller closed) —
        // never let a final emit turn a clean stop into a stream error.
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          // stream already closed — nothing left to notify
        }
      }
      try {
        await runAgentLoop({
          client,
          model,
          system: SYSTEM_PROMPT,
          tools,
          messages: messages!,
          toolContext: { actor: { type: 'agent', id: 'roam-chat' }, orgId },
          emit,
          // Stop the loop (no further model calls or tool mutations) when the client
          // disconnects or cancels the request.
          signal: request.signal,
        })
      } catch (err) {
        emit({
          type: 'error',
          message: err instanceof Error ? err.message : 'Agent request failed.',
        })
        emit({ type: 'done' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
