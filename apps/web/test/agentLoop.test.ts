// The tool-use loop, exercised end-to-end with a mocked Anthropic client (no network):
// one full round of tool_use -> tool_result -> final text, plus the guard rails
// (unknown tool, iteration cap, context threading).
import { describe, expect, it } from 'vitest'
import type { EngineToolDef, ToolRunContext } from '@retentionos/mcp-engine/tools'
import {
  runAgentLoop,
  summarizeToolCall,
  type AgentStreamEvent,
  type AnthropicClientLike,
  type FinalMessageLike,
} from '../lib/agent/loop'

/** Scripted mock: each entry is one model turn; streams its text blocks via on('text'). */
function mockClient(turns: FinalMessageLike[]) {
  const calls: Array<Record<string, unknown>> = []
  let i = 0
  const client: AnthropicClientLike = {
    messages: {
      stream(params) {
        calls.push(params)
        const turn = turns[Math.min(i, turns.length - 1)]!
        i++
        const listeners: Array<(delta: string) => void> = []
        return {
          on(_event: 'text', listener: (delta: string) => void) {
            listeners.push(listener)
            return this
          },
          async finalMessage() {
            for (const block of turn.content) {
              if (block.type === 'text' && typeof block.text === 'string') {
                for (const l of listeners) l(block.text)
              }
            }
            return turn
          },
        }
      },
    },
  }
  return { client, calls }
}

function fakeTool(overrides: Partial<EngineToolDef> = {}) {
  const seen: Array<{ args: Record<string, unknown>; ctx: ToolRunContext | undefined }> = []
  const tool: EngineToolDef = {
    name: 'list_tables',
    title: 'List tables',
    description: 'stub',
    inputSchema: {},
    run: async (args, ctx) => {
      seen.push({ args, ctx })
      return { content: [{ type: 'text', text: JSON.stringify({ tables: [1, 2, 3] }) }] }
    },
    ...overrides,
  }
  return { tool, seen }
}

const toolContext: ToolRunContext = { actor: { type: 'agent', id: 'roam-chat' }, orgId: 'org-1' }

function collect() {
  const events: AgentStreamEvent[] = []
  return { events, emit: (e: AgentStreamEvent) => events.push(e) }
}

describe('runAgentLoop', () => {
  it('runs one tool round: tool_use -> tool_result -> final text', async () => {
    const { tool, seen } = fakeTool()
    const { client, calls } = mockClient([
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Let me check. ' },
          { type: 'tool_use', id: 'tu_1', name: 'list_tables', input: {} },
        ],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'You have 3 tables.' }] },
    ])
    const { events, emit } = collect()

    await runAgentLoop({
      client,
      model: 'claude-test',
      system: 'sys',
      tools: [tool],
      messages: [{ role: 'user', content: 'What tables do we have?' }],
      toolContext,
      emit,
    })

    // Two model turns were made
    expect(calls).toHaveLength(2)
    // First call carries the converted tool schema and the system prompt
    expect(calls[0]!.system).toBe('sys')
    const wireTools = calls[0]!.tools as Array<{ name: string; input_schema: unknown }>
    expect(wireTools[0]!.name).toBe('list_tables')
    expect(wireTools[0]!.input_schema).toMatchObject({ type: 'object' })

    // The second call's messages end with ONE user turn holding the tool_result
    const messages = calls[1]!.messages as Array<{ role: string; content: unknown }>
    expect(messages).toHaveLength(3) // user, assistant(tool_use), user(tool_result)
    const resultTurn = messages[2]!
    expect(resultTurn.role).toBe('user')
    const blocks = resultTurn.content as Array<Record<string, unknown>>
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_1' })
    expect(String(blocks[0]!.content)).toContain('"tables"')

    // The handler received the per-call context (actor + org pin)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.ctx).toEqual(toolContext)

    // Emitted: text delta, tool chip, final text delta, done — in order
    expect(events.map((e) => e.type)).toEqual(['text', 'tool', 'text', 'done'])
    const chip = events[1] as Extract<AgentStreamEvent, { type: 'tool' }>
    expect(chip.tool).toBe('list_tables')
    expect(chip.summary).toContain('3 tables')
  })

  it('answers unknown tools with an is_error tool_result instead of crashing', async () => {
    const { client, calls } = mockClient([
      {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu_x', name: 'not_a_tool', input: {} }],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Sorry.' }] },
    ])
    const { events, emit } = collect()

    await runAgentLoop({
      client,
      model: 'claude-test',
      system: 'sys',
      tools: [fakeTool().tool],
      messages: [{ role: 'user', content: 'hi' }],
      toolContext,
      emit,
    })

    const messages = calls[1]!.messages as Array<{ role: string; content: unknown }>
    const blocks = messages[2]!.content as Array<Record<string, unknown>>
    expect(blocks[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_x', is_error: true })
    const chip = events.find((e) => e.type === 'tool') as Extract<AgentStreamEvent, { type: 'tool' }>
    expect(chip.isError).toBe(true)
  })

  it('aborting after the first tool executes no second tool and no second model call', async () => {
    const controller = new AbortController()
    const seen: Array<Record<string, unknown>> = []
    const tool: EngineToolDef = {
      name: 'list_tables',
      title: 'List tables',
      description: 'stub',
      inputSchema: {},
      run: async (args) => {
        seen.push(args)
        controller.abort() // the client disconnects while the first tool runs
        return { content: [{ type: 'text', text: JSON.stringify({ tables: [] }) }] }
      },
    }
    const { client, calls } = mockClient([
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'tu_1', name: 'list_tables', input: { n: 1 } },
          { type: 'tool_use', id: 'tu_2', name: 'list_tables', input: { n: 2 } },
        ],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'never reached' }] },
    ])
    const { events, emit } = collect()

    await runAgentLoop({
      client,
      model: 'claude-test',
      system: 'sys',
      tools: [tool],
      messages: [{ role: 'user', content: 'do two things' }],
      toolContext,
      signal: controller.signal,
      emit,
    })

    expect(seen).toHaveLength(1) // second tool_use never executed
    expect(seen[0]).toEqual({ n: 1 })
    expect(calls).toHaveLength(1) // and no follow-up model call
    expect(events.at(-1)).toEqual({ type: 'done' }) // best-effort final done
  })

  it('an already-aborted signal makes no model calls at all', async () => {
    const controller = new AbortController()
    controller.abort()
    const { tool, seen } = fakeTool()
    const { client, calls } = mockClient([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'hi' }] },
    ])
    const { events, emit } = collect()

    await runAgentLoop({
      client,
      model: 'claude-test',
      system: 'sys',
      tools: [tool],
      messages: [{ role: 'user', content: 'hello' }],
      toolContext,
      signal: controller.signal,
      emit,
    })

    expect(calls).toHaveLength(0)
    expect(seen).toHaveLength(0)
    expect(events).toEqual([{ type: 'done' }])
  })

  it('stops after maxIterations and tells the user', async () => {
    const { tool } = fakeTool()
    const { client, calls } = mockClient([
      {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu_loop', name: 'list_tables', input: {} }],
      },
    ])
    const { events, emit } = collect()

    await runAgentLoop({
      client,
      model: 'claude-test',
      system: 'sys',
      tools: [tool],
      messages: [{ role: 'user', content: 'loop forever' }],
      toolContext,
      maxIterations: 2,
      emit,
    })

    expect(calls).toHaveLength(2)
    expect(events.at(-1)).toEqual({ type: 'done' })
    const lastText = events.filter((e) => e.type === 'text').at(-1) as { text: string }
    expect(lastText.text).toContain('tool-call limit')
  })
})

describe('summarizeToolCall', () => {
  const okResult = (data: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(data) }],
  })

  it('summarizes queries with record counts', () => {
    const s = summarizeToolCall('query_records', { table: 'Leads' }, okResult({ records: [1, 2, 3], total: 3 }))
    expect(s).toBe('📋 Queried Leads — 3 records')
  })

  it('summarizes record updates', () => {
    const s = summarizeToolCall('update_record', { table: 'Clients' }, okResult({ record: {} }))
    expect(s).toBe('✏️ Updated record in Clients')
  })

  it('summarizes failures with the engine error code', () => {
    const s = summarizeToolCall(
      'delete_table',
      { table: 'Ghost' },
      { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code: 'not_found' } }) }] },
    )
    expect(s).toContain('delete_table failed — not_found')
  })
})
