// The OpenRouter provider adapter, exercised through the real runAgentLoop with a
// mocked fetch (no network): an OpenAI-shaped SSE stream drives one full round
// (tool_calls -> role:'tool' result -> final text) and must produce the SAME
// AgentStreamEvent shape as the Anthropic path, plus abort and HTTP-error behavior.
import { describe, expect, it } from 'vitest'
import type { EngineToolDef, ToolRunContext } from '@retentionos/mcp-engine/tools'
import { runAgentLoop, type AgentStreamEvent } from '../lib/agent/loop'
import { createOpenRouterClient, OPENROUTER_DEFAULT_MODEL } from '../lib/agent/openrouter'

const toolContext: ToolRunContext = { actor: { type: 'agent', id: 'roam-chat' }, orgId: 'org-1' }

function collect() {
  const events: AgentStreamEvent[] = []
  return { events, emit: (e: AgentStreamEvent) => events.push(e) }
}

function fakeTool() {
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
  }
  return { tool, seen }
}

/** Build a Response whose body streams the given SSE frames (one enqueue per frame,
 * so multi-chunk parsing is exercised). */
function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

const data = (chunk: unknown) => `data: ${JSON.stringify(chunk)}\n\n`

/** Scripted fetch: records each request (URL, headers, parsed body), returns the
 * next scripted response. */
function mockFetch(responses: Response[]) {
  const requests: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = []
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    requests.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    })
    if (responses.length === 0) throw new Error('mock fetch exhausted')
    return responses.shift()!
  }) as typeof fetch
  return { fetchImpl, requests }
}

describe('OpenRouter provider (via runAgentLoop)', () => {
  it('runs one full round: tool_calls -> tool result -> final text, matching the Anthropic event shape', async () => {
    const { tool, seen } = fakeTool()
    const { fetchImpl, requests } = mockFetch([
      // Turn 1: text delta, then a tool call with arguments SPLIT across chunks,
      // plus an OpenRouter comment line the parser must skip.
      sseResponse([
        ': OPENROUTER PROCESSING\n\n',
        data({ choices: [{ delta: { content: 'Let me check. ' } }] }),
        data({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'call_1', function: { name: 'list_tables', arguments: '{"li' } },
                ],
              },
            },
          ],
        }),
        data({
          choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'mit":5}' } }] } }],
        }),
        data({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
        'data: [DONE]\n\n',
      ]),
      // Turn 2: final text.
      sseResponse([
        data({ choices: [{ delta: { content: 'You have 3 tables.' } }] }),
        data({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
        'data: [DONE]\n\n',
      ]),
    ])
    const { events, emit } = collect()

    await runAgentLoop({
      client: createOpenRouterClient({ apiKey: 'or-key', fetchImpl }),
      model: OPENROUTER_DEFAULT_MODEL,
      system: 'sys',
      tools: [tool],
      messages: [{ role: 'user', content: 'What tables do we have?' }],
      toolContext,
      emit,
    })

    // Same event shape as the Anthropic path: text delta, tool chip, final text, done.
    expect(events.map((e) => e.type)).toEqual(['text', 'tool', 'text', 'done'])
    expect(events[0]).toEqual({ type: 'text', text: 'Let me check. ' })
    const chip = events[1] as Extract<AgentStreamEvent, { type: 'tool' }>
    expect(chip.tool).toBe('list_tables')
    expect(chip.summary).toContain('3 tables')
    expect(events[2]).toEqual({ type: 'text', text: 'You have 3 tables.' })

    // The tool got the parsed streamed arguments and the per-call context.
    expect(seen).toHaveLength(1)
    expect(seen[0]!.args).toEqual({ limit: 5 })
    expect(seen[0]!.ctx).toEqual(toolContext)

    // Request 1: OpenRouter endpoint, auth + attribution headers, OpenAI-format tools.
    expect(requests).toHaveLength(2)
    expect(requests[0]!.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(requests[0]!.headers.Authorization).toBe('Bearer or-key')
    expect(requests[0]!.headers['HTTP-Referer']).toContain('RetentionOS')
    expect(requests[0]!.headers['X-Title']).toBe('RetentionOS')
    expect(requests[0]!.body.stream).toBe(true)
    expect(requests[0]!.body.model).toBe(OPENROUTER_DEFAULT_MODEL)
    const wireTools = requests[0]!.body.tools as Array<{
      type: string
      function: { name: string; parameters: unknown }
    }>
    expect(wireTools[0]!.type).toBe('function')
    expect(wireTools[0]!.function.name).toBe('list_tables')
    expect(wireTools[0]!.function.parameters).toMatchObject({ type: 'object' })
    const firstMessages = requests[0]!.body.messages as Array<Record<string, unknown>>
    expect(firstMessages[0]).toMatchObject({ role: 'system', content: 'sys' })

    // Request 2: assistant tool_calls echoed back + the role:'tool' result.
    const messages = requests[1]!.body.messages as Array<Record<string, unknown>>
    // system, user, assistant(tool_calls), tool
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool'])
    const assistant = messages[2]!
    const toolCalls = assistant.tool_calls as Array<{ id: string; function: { name: string } }>
    expect(toolCalls[0]!.id).toBe('call_1')
    expect(toolCalls[0]!.function.name).toBe('list_tables')
    const toolMsg = messages[3]!
    expect(toolMsg.tool_call_id).toBe('call_1')
    expect(String(toolMsg.content)).toContain('"tables"')
  })

  it('aborting during the first tool executes no second tool and no second request', async () => {
    const controller = new AbortController()
    const seen: Array<Record<string, unknown>> = []
    const tool: EngineToolDef = {
      name: 'list_tables',
      title: 'List tables',
      description: 'stub',
      inputSchema: {},
      run: async (args) => {
        seen.push(args)
        controller.abort() // client disconnects while the first tool runs
        return { content: [{ type: 'text', text: JSON.stringify({ tables: [] }) }] }
      },
    }
    const { fetchImpl, requests } = mockFetch([
      sseResponse([
        data({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'c1', function: { name: 'list_tables', arguments: '{"n":1}' } },
                  { index: 1, id: 'c2', function: { name: 'list_tables', arguments: '{"n":2}' } },
                ],
              },
            },
          ],
        }),
        data({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
        'data: [DONE]\n\n',
      ]),
    ])
    const { events, emit } = collect()

    await runAgentLoop({
      client: createOpenRouterClient({ apiKey: 'or-key', fetchImpl, signal: controller.signal }),
      model: OPENROUTER_DEFAULT_MODEL,
      system: 'sys',
      tools: [tool],
      messages: [{ role: 'user', content: 'do two things' }],
      toolContext,
      signal: controller.signal,
      emit,
    })

    expect(seen).toHaveLength(1) // second parallel tool_call never executed
    expect(seen[0]).toEqual({ n: 1 })
    expect(requests).toHaveLength(1) // and no follow-up model request
    expect(events.at(-1)).toEqual({ type: 'done' })
  })

  it('an abort mid-stream resolves to a clean done instead of an error event', async () => {
    const controller = new AbortController()
    const fetchImpl = (async () => {
      controller.abort()
      throw new DOMException('The operation was aborted.', 'AbortError')
    }) as unknown as typeof fetch
    const { events, emit } = collect()

    await runAgentLoop({
      client: createOpenRouterClient({ apiKey: 'or-key', fetchImpl, signal: controller.signal }),
      model: OPENROUTER_DEFAULT_MODEL,
      system: 'sys',
      tools: [fakeTool().tool],
      messages: [{ role: 'user', content: 'hi' }],
      toolContext,
      signal: controller.signal,
      emit,
    })

    expect(events).toEqual([{ type: 'done' }])
  })

  it('surfaces non-2xx responses as an error (caller emits the error event)', async () => {
    const { fetchImpl } = mockFetch([new Response('nope', { status: 401 })])
    const { emit } = collect()

    await expect(
      runAgentLoop({
        client: createOpenRouterClient({ apiKey: 'bad-key', fetchImpl }),
        model: OPENROUTER_DEFAULT_MODEL,
        system: 'sys',
        tools: [fakeTool().tool],
        messages: [{ role: 'user', content: 'hi' }],
        toolContext,
        emit,
      }),
    ).rejects.toThrow('OpenRouter request failed (HTTP 401).')
  })
})
