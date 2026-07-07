// Agent conversation store (migration 0012): CRUD, transcript round-trip, the
// appendMessages batch (updated_at bump + auto-title from the first user message),
// input validation, and tenant isolation.
import { beforeAll, describe, expect, it } from 'vitest'
import {
  CONVERSATION_TITLE_MAX,
  appendMessages,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
} from '../src/index'
import type { AgentMessagePart } from '../src/index'
import { ensureTestOrg } from './helpers'

let orgId: string

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required for engine tests')
  orgId = await ensureTestOrg()
})

const text = (t: string): AgentMessagePart[] => [{ kind: 'text', text: t }]

describe('conversation lifecycle', () => {
  it('creates untitled by default, with a trimmed title when provided', async () => {
    const untitled = await createConversation(orgId)
    expect(untitled.title).toBeNull()
    expect(untitled.organization_id).toBe(orgId)

    const titled = await createConversation(orgId, { title: '  Pipeline cleanup  ' })
    expect(titled.title).toBe('Pipeline cleanup')
  })

  it('getConversation returns the transcript oldest-first; missing id is not_found', async () => {
    const conv = await createConversation(orgId)
    await appendMessages(orgId, conv.id, [
      { role: 'user', content: text('What tables do we have?') },
      {
        role: 'assistant',
        content: [
          { kind: 'tool', tool: 'list_tables', summary: '📋 Listed tables — 2 tables' },
          { kind: 'text', text: 'You have 2 tables.' },
        ],
      },
    ])
    await appendMessages(orgId, conv.id, [{ role: 'user', content: text('Thanks!') }])

    const { conversation, messages } = await getConversation(orgId, conv.id)
    expect(conversation.id).toBe(conv.id)
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    // Tool chips survive the round-trip in the UI shape.
    expect(messages[1]!.content).toEqual([
      { kind: 'tool', tool: 'list_tables', summary: '📋 Listed tables — 2 tables' },
      { kind: 'text', text: 'You have 2 tables.' },
    ])

    await expect(
      getConversation(orgId, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('deleteConversation removes the thread and its messages; missing is not_found', async () => {
    const conv = await createConversation(orgId)
    await appendMessages(orgId, conv.id, [{ role: 'user', content: text('bye') }])
    await deleteConversation(orgId, conv.id)
    await expect(getConversation(orgId, conv.id)).rejects.toMatchObject({ code: 'not_found' })
    await expect(deleteConversation(orgId, conv.id)).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('listConversations', () => {
  it('lists recent-first (appendMessages bumps updated_at) and honors limit', async () => {
    const listOrg = await ensureTestOrg()
    const a = await createConversation(listOrg, { title: 'A' })
    const b = await createConversation(listOrg, { title: 'B' })

    // Touch A after B was created — A must sort back to the top.
    await appendMessages(listOrg, a.id, [{ role: 'user', content: text('ping') }])

    const all = await listConversations(listOrg)
    expect(all.map((c) => c.id)).toEqual([a.id, b.id])

    const limited = await listConversations(listOrg, { limit: 1 })
    expect(limited.map((c) => c.id)).toEqual([a.id])
  })

  it('rejects a non-positive or non-integer limit', async () => {
    await expect(listConversations(orgId, { limit: 0 })).rejects.toMatchObject({
      code: 'bad_input',
    })
    await expect(listConversations(orgId, { limit: 1.5 })).rejects.toMatchObject({
      code: 'bad_input',
    })
  })
})

describe('appendMessages — auto-title', () => {
  it('titles an untitled conversation from the first user message in the batch', async () => {
    const conv = await createConversation(orgId)
    await appendMessages(orgId, conv.id, [
      { role: 'user', content: text('Add a Priority field to Tasks') },
      { role: 'assistant', content: text('Done.') },
    ])
    const { conversation } = await getConversation(orgId, conv.id)
    expect(conversation.title).toBe('Add a Priority field to Tasks')
  })

  it('truncates long titles to ~60 chars with an ellipsis', async () => {
    const conv = await createConversation(orgId)
    const long = 'x'.repeat(200)
    await appendMessages(orgId, conv.id, [{ role: 'user', content: text(long) }])
    const { conversation } = await getConversation(orgId, conv.id)
    expect(conversation.title!.length).toBeLessThanOrEqual(CONVERSATION_TITLE_MAX)
    expect(conversation.title!.endsWith('…')).toBe(true)
  })

  it('never overwrites an existing title, and skips assistant-only batches', async () => {
    const conv = await createConversation(orgId)
    await appendMessages(orgId, conv.id, [{ role: 'assistant', content: text('unprompted') }])
    expect((await getConversation(orgId, conv.id)).conversation.title).toBeNull()

    await appendMessages(orgId, conv.id, [{ role: 'user', content: text('First real ask') }])
    expect((await getConversation(orgId, conv.id)).conversation.title).toBe('First real ask')

    await appendMessages(orgId, conv.id, [{ role: 'user', content: text('Second ask') }])
    expect((await getConversation(orgId, conv.id)).conversation.title).toBe('First real ask')
  })

  it('validates the batch: non-empty, known roles, array content', async () => {
    const conv = await createConversation(orgId)
    await expect(appendMessages(orgId, conv.id, [])).rejects.toMatchObject({ code: 'bad_input' })
    await expect(
      appendMessages(orgId, conv.id, [
        { role: 'system' as never, content: text('nope') },
      ]),
    ).rejects.toMatchObject({ code: 'bad_input' })
    await expect(
      appendMessages(orgId, conv.id, [{ role: 'user', content: 'raw string' as never }]),
    ).rejects.toMatchObject({ code: 'bad_input' })
    // Nothing was persisted by the rejected batches.
    expect((await getConversation(orgId, conv.id)).messages).toHaveLength(0)
  })

  it('appending to a missing conversation is not_found', async () => {
    await expect(
      appendMessages(orgId, '00000000-0000-0000-0000-000000000000', [
        { role: 'user', content: text('hello?') },
      ]),
    ).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('tenant isolation', () => {
  it('conversations are invisible and untouchable from another org', async () => {
    const otherOrg = await ensureTestOrg()
    const conv = await createConversation(orgId, { title: 'Private' })
    await appendMessages(orgId, conv.id, [{ role: 'user', content: text('secret') }])

    const foreignList = await listConversations(otherOrg)
    expect(foreignList.map((c) => c.id)).not.toContain(conv.id)

    await expect(getConversation(otherOrg, conv.id)).rejects.toMatchObject({ code: 'not_found' })
    await expect(
      appendMessages(otherOrg, conv.id, [{ role: 'user', content: text('intrusion') }]),
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(deleteConversation(otherOrg, conv.id)).rejects.toMatchObject({
      code: 'not_found',
    })

    // The original org still sees an intact, un-mutated thread.
    const { conversation, messages } = await getConversation(orgId, conv.id)
    expect(conversation.title).toBe('Private')
    expect(messages).toHaveLength(1)
  })
})
