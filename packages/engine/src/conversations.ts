// Agent conversation store — persistence for the in-app chat panel (migration 0012).
// The panel's transcript is stored in its UI shape: each agent_messages.content is the
// message's parts array (text blocks and tool action chips), so a reloaded conversation
// renders exactly what was streamed. Tenant-scoped by organizationId like every other
// engine function; the chat route and /api/v1/conversations are the clients.

import { getPool, query, queryOne } from '@retentionos/db'
import { EngineError } from './types'

// ---------------------------------------------------------------------------
// Types — mirror migration 0012.
// ---------------------------------------------------------------------------

export type AgentMessageRole = 'user' | 'assistant'

export interface AgentConversation {
  id: string
  organization_id: string
  /** Null until the first appendMessages auto-titles it from the first user message. */
  title: string | null
  created_at: string
  updated_at: string
}

/** One persisted part of a chat-panel message (the panel's ChatPart shape). */
export type AgentMessagePart =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; tool: string; summary: string; isError?: boolean }

export interface AgentMessage {
  id: string
  conversation_id: string
  organization_id: string
  /** Insertion order (bigint — pg returns it as a string). */
  seq: string
  role: AgentMessageRole
  content: AgentMessagePart[]
  created_at: string
}

export interface AgentMessageInput {
  role: AgentMessageRole
  content: AgentMessagePart[]
}

export interface ConversationWithMessages {
  conversation: AgentConversation
  messages: AgentMessage[]
}

const CONVERSATION_COLS = 'id, organization_id, title, created_at, updated_at'
const MESSAGE_COLS = 'id, conversation_id, organization_id, seq, role, content, created_at'

/** How many characters of the first user message become the auto-title. */
export const CONVERSATION_TITLE_MAX = 60

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createConversation(
  orgId: string,
  input: { title?: string | null } = {},
): Promise<AgentConversation> {
  const title = input.title?.trim() || null
  const row = await queryOne<AgentConversation>(
    `insert into public.agent_conversations (organization_id, title)
     values ($1, $2)
     returning ${CONVERSATION_COLS}`,
    [orgId, title],
  )
  if (!row) throw new EngineError('Failed to create conversation.')
  return row
}

/** Recent conversations, most recently touched first. */
export async function listConversations(
  orgId: string,
  opts: { limit?: number } = {},
): Promise<AgentConversation[]> {
  const limit = clampLimit(opts.limit)
  return query<AgentConversation>(
    `select ${CONVERSATION_COLS} from public.agent_conversations
     where organization_id = $1
     order by updated_at desc, created_at desc
     limit $2`,
    [orgId, limit],
  )
}

function clampLimit(raw: number | undefined): number {
  const DEFAULT = 50
  const MAX = 200
  if (raw === undefined) return DEFAULT
  if (!Number.isInteger(raw) || raw < 1) {
    throw new EngineError('limit must be a positive integer.', 'bad_input')
  }
  return Math.min(raw, MAX)
}

/** A conversation plus its full transcript (messages oldest-first). not_found if it
 * doesn't exist in this org. */
export async function getConversation(
  orgId: string,
  conversationId: string,
): Promise<ConversationWithMessages> {
  const conversation = await queryOne<AgentConversation>(
    `select ${CONVERSATION_COLS} from public.agent_conversations
     where organization_id = $1 and id = $2`,
    [orgId, conversationId],
  )
  if (!conversation) throw new EngineError('Conversation not found.', 'not_found')
  const messages = await query<AgentMessage>(
    `select ${MESSAGE_COLS} from public.agent_messages
     where organization_id = $1 and conversation_id = $2
     order by seq asc`,
    [orgId, conversationId],
  )
  return { conversation, messages }
}

/**
 * Append a batch of messages to a conversation (one transaction): inserts the messages
 * in order, bumps the conversation's updated_at (so it sorts to the top of the recents
 * list), and — if the conversation is still untitled — titles it from the first user
 * message in the batch (first ~60 chars of its text parts).
 */
export async function appendMessages(
  orgId: string,
  conversationId: string,
  messages: AgentMessageInput[],
): Promise<AgentMessage[]> {
  if (messages.length === 0) {
    throw new EngineError('appendMessages requires at least one message.', 'bad_input')
  }
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') {
      throw new EngineError('Message role must be "user" or "assistant".', 'bad_input')
    }
    if (!Array.isArray(m.content)) {
      throw new EngineError('Message content must be an array of parts.', 'bad_input')
    }
  }

  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('begin')
    // Lock the conversation row for the duration of the batch: concurrent appends
    // serialize instead of double-titling, and a missing/foreign row is a clean 404.
    const conv = await client.query(
      `select id, title from public.agent_conversations
       where organization_id = $1 and id = $2 for update`,
      [orgId, conversationId],
    )
    if ((conv.rowCount ?? 0) === 0) {
      await client.query('rollback')
      throw new EngineError('Conversation not found.', 'not_found')
    }

    const inserted: AgentMessage[] = []
    for (const m of messages) {
      const res = await client.query(
        `insert into public.agent_messages (conversation_id, organization_id, role, content)
         values ($1, $2, $3, $4::jsonb)
         returning ${MESSAGE_COLS}`,
        [conversationId, orgId, m.role, JSON.stringify(m.content)],
      )
      inserted.push(res.rows[0] as AgentMessage)
    }

    // Auto-title from the first user message in the batch (only while untitled).
    const currentTitle = (conv.rows[0] as { title: string | null }).title
    const derived = currentTitle === null ? deriveTitle(messages) : null
    await client.query(
      derived !== null
        ? 'update public.agent_conversations set updated_at = now(), title = $2 where id = $1'
        : 'update public.agent_conversations set updated_at = now() where id = $1',
      derived !== null ? [conversationId, derived] : [conversationId],
    )

    await client.query('commit')
    return inserted
  } catch (err) {
    if (!(err instanceof EngineError)) await client.query('rollback')
    throw err
  } finally {
    client.release()
  }
}

/** First ~60 chars of the first user message's text parts; null when there's nothing usable. */
function deriveTitle(messages: AgentMessageInput[]): string | null {
  const firstUser = messages.find((m) => m.role === 'user')
  if (!firstUser) return null
  const text = firstUser.content
    .filter((p): p is Extract<AgentMessagePart, { kind: 'text' }> => p?.kind === 'text')
    .map((p) => p.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return null
  return text.length > CONVERSATION_TITLE_MAX
    ? `${text.slice(0, CONVERSATION_TITLE_MAX - 1).trimEnd()}…`
    : text
}

/** Delete a conversation (messages cascade). not_found if it isn't in this org. */
export async function deleteConversation(orgId: string, conversationId: string): Promise<void> {
  const res = await query<{ id: string }>(
    `delete from public.agent_conversations
     where organization_id = $1 and id = $2 returning id`,
    [orgId, conversationId],
  )
  if (res.length === 0) throw new EngineError('Conversation not found.', 'not_found')
}
