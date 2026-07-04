import { query, queryOne } from './pool'
import type { Conversation, ConversationMessage, ConversationMessageRole } from './types'

const CONVERSATION_COLUMNS = `
  id, organization_id, user_id, title, created_at, updated_at
`

const CONVERSATION_MESSAGE_COLUMNS = `
  id, organization_id, conversation_id, role, content, citations, created_at
`

export interface CreateConversationInput {
  user_id?: string
  title?: string
}

export async function createConversation(
  orgId: string,
  input: CreateConversationInput = {},
): Promise<Conversation> {
  const row = await queryOne<Conversation>(
    `insert into public.conversations (organization_id, user_id, title)
     values ($1, $2, $3)
     returning ${CONVERSATION_COLUMNS}`,
    [orgId, input.user_id ?? null, input.title ?? null],
  )
  if (!row) throw new Error('Failed to create conversation')
  return row
}

export interface ListConversationsOptions {
  limit?: number
}

/** Tenant-scoped: always filtered by organization_id. */
export async function listConversations(
  orgId: string,
  opts: ListConversationsOptions = {},
): Promise<Conversation[]> {
  const params: unknown[] = [orgId]
  let sql = `select ${CONVERSATION_COLUMNS} from public.conversations
     where organization_id = $1
     order by updated_at desc`
  if (opts.limit) {
    params.push(opts.limit)
    sql += ` limit $${params.length}`
  }
  return query<Conversation>(sql, params)
}

export async function getConversation(orgId: string, id: string): Promise<Conversation | null> {
  return queryOne<Conversation>(
    `select ${CONVERSATION_COLUMNS} from public.conversations where organization_id = $1 and id = $2`,
    [orgId, id],
  )
}

export interface AddMessageInput {
  conversation_id: string
  role: ConversationMessageRole
  content: string
  citations?: unknown[]
}

/**
 * Append a turn to a conversation. Also bumps the conversation's updated_at so
 * listConversations (ordered by updated_at desc) surfaces recently-active threads first.
 */
export async function addMessage(
  orgId: string,
  input: AddMessageInput,
): Promise<ConversationMessage> {
  const row = await queryOne<ConversationMessage>(
    `insert into public.conversation_messages
       (organization_id, conversation_id, role, content, citations)
     values ($1, $2, $3, $4, coalesce($5::jsonb, '[]'::jsonb))
     returning ${CONVERSATION_MESSAGE_COLUMNS}`,
    [
      orgId,
      input.conversation_id,
      input.role,
      input.content,
      input.citations ? JSON.stringify(input.citations) : null,
    ],
  )
  if (!row) throw new Error('Failed to add conversation message')

  await query(
    `update public.conversations set updated_at = now()
     where organization_id = $1 and id = $2`,
    [orgId, input.conversation_id],
  )

  return row
}

// Named listConversationMessages (not listMessages) to avoid colliding with the existing
// public.messages (campaign sends) listMessages() export in src/messages.ts — both are
// re-exported from src/index.ts, so the names must be distinct.
export async function listConversationMessages(
  orgId: string,
  conversationId: string,
): Promise<ConversationMessage[]> {
  return query<ConversationMessage>(
    `select ${CONVERSATION_MESSAGE_COLUMNS} from public.conversation_messages
     where organization_id = $1 and conversation_id = $2
     order by created_at asc`,
    [orgId, conversationId],
  )
}
