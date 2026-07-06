// The route's keyless and validation paths, invoking the handlers directly (no server,
// no database — both paths return before any org/db work), plus env-based provider
// selection (Anthropic first-class, OpenRouter fallback).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from '../app/api/agent/chat/route'
import { chooseAgentProvider } from '../lib/agent/provider'

afterEach(() => {
  vi.unstubAllEnvs()
})

function post(body: unknown): Request {
  return new Request('http://localhost/api/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('keyless path (no ANTHROPIC_API_KEY, no OPENROUTER_API_KEY)', () => {
  it('GET returns 200 {disabled: true}', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubEnv('OPENROUTER_API_KEY', '')
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ disabled: true })
  })

  it('POST returns 200 {disabled: true} without touching the body', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubEnv('OPENROUTER_API_KEY', '')
    const res = await POST(post({ messages: [{ role: 'user', content: 'hello' }] }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ disabled: true })
  })
})

describe('provider selection (env precedence)', () => {
  it('GET reports enabled with only OPENROUTER_API_KEY', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubEnv('OPENROUTER_API_KEY', 'or-key')
    expect(await (await GET()).json()).toEqual({ disabled: false })
  })

  it('both keys set → Anthropic wins', () => {
    const config = chooseAgentProvider({
      ANTHROPIC_API_KEY: 'ant-key',
      OPENROUTER_API_KEY: 'or-key',
    })
    expect(config).toEqual({ provider: 'anthropic', apiKey: 'ant-key', model: 'claude-sonnet-5' })
  })

  it('only OPENROUTER_API_KEY → openrouter with the OpenRouter default model', () => {
    const config = chooseAgentProvider({ OPENROUTER_API_KEY: 'or-key' })
    expect(config).toEqual({
      provider: 'openrouter',
      apiKey: 'or-key',
      model: 'anthropic/claude-sonnet-5',
    })
  })

  it('ROS_AGENT_MODEL overrides the default for the active provider', () => {
    const config = chooseAgentProvider({
      OPENROUTER_API_KEY: 'or-key',
      ROS_AGENT_MODEL: 'anthropic/claude-opus-4.1',
    })
    expect(config?.model).toBe('anthropic/claude-opus-4.1')
  })

  it('neither key → null (disabled)', () => {
    expect(chooseAgentProvider({})).toBeNull()
  })
})

describe('request validation (key present, before any model/db call)', () => {
  it('GET reports enabled when a key is set', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    expect(await (await GET()).json()).toEqual({ disabled: false })
  })

  it.each([
    ['missing messages', {}],
    ['empty messages', { messages: [] }],
    ['bad role', { messages: [{ role: 'system', content: 'x' }] }],
    ['non-string content', { messages: [{ role: 'user', content: 42 }] }],
    ['blank content', { messages: [{ role: 'user', content: '   ' }] }],
    ['first turn not user', { messages: [{ role: 'assistant', content: 'hi' }] }],
  ])('rejects %s with 400 bad_input', async (_label, body) => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    const res = await POST(post(body))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'bad_input' })
  })

  it('rejects a non-JSON body with 400', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    const res = await POST(
      new Request('http://localhost/api/agent/chat', { method: 'POST', body: 'not json{' }),
    )
    expect(res.status).toBe(400)
  })
})
