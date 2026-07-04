#!/usr/bin/env tsx
// Backbone MCP server — the "chat with everything" layer (docs/04-ai-and-agent-layer.md).
//
// Exposes the retrieval + memory tool surface for Phase 6's data backbone: a single
// keyless search across every subsystem (clients, contacts, documents, tasks, campaigns,
// customers, activities) plus conversation persistence — over stdio, backed by
// @retentionos/db — the SAME data-access layer the web app uses. So the same tools work
// from Claude Desktop/Code and from an OpenAI Agents-SDK caller, against the same owned
// Postgres.
//
// This server does no reasoning of its own and makes no LLM call — the agent host does
// the reasoning over the hits this server returns. It only retrieves and remembers.
//
// Tenant-safety: this server talks to Postgres directly (no RLS), so it MUST scope every
// query by organization_id itself. It never becomes a backdoor around tenancy — every
// tool resolves its org via resolveOrg() before touching the database.

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  getDefaultOrganization,
  searchEverything,
  createConversation,
  listConversations,
  getConversation,
  addMessage,
  listConversationMessages,
} from '@retentionos/db'
import { z } from 'zod'

// The org this server operates within. In-app runtime derives this from the authed
// session; for the stdio server it's provided by env (or per-tool override).
const DEFAULT_ORG_ID = process.env.RETENTIONOS_ORG_ID

if (!process.env.DATABASE_URL) {
  // @retentionos/db's connection pool throws lazily on first query if this is unset —
  // fail fast here instead, with a message that points at the fix.
  console.error('Missing DATABASE_URL. See .env.example / docs/LOCAL_DEV.md.')
  process.exit(1)
}

/**
 * Resolve the organization to scope a tool call to: an explicit per-call override, else
 * the server-wide RETENTIONOS_ORG_ID, else the first (only, in dev) organization in the
 * database. Throws if none of those resolve — every tool must call this before touching
 * the database, so tenant scoping is never accidentally skipped.
 */
async function resolveOrg(inputOrgId?: string): Promise<string> {
  if (inputOrgId) return inputOrgId
  if (DEFAULT_ORG_ID) return DEFAULT_ORG_ID
  const org = await getDefaultOrganization()
  if (org?.id) return org.id
  throw new Error(
    'No organization_id provided, RETENTIONOS_ORG_ID is not set, and no organization exists.',
  )
}

function ok(result: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return { isError: true, content: [{ type: 'text' as const, text: message }] }
}

const organizationIdField = z
  .string()
  .uuid()
  .optional()
  .describe(
    'Organization to scope to. Defaults to the server RETENTIONOS_ORG_ID, then the ' +
      'first organization in the database. Only pass this if you need to target a ' +
      'specific tenant explicitly.',
  )

const clientIdField = z
  .string()
  .uuid()
  .optional()
  .describe('Optional client account id (UUID) to scope results to a single client.')

const limitField = z.number().int().min(1).max(500).optional()

const conversationIdField = z.string().uuid().describe('The conversation id (UUID).')

const server = new McpServer({
  name: 'retentionos-backbone',
  version: '0.1.0',
})

server.registerTool(
  'search_everything',
  {
    title: 'Search everything',
    description:
      'The one tool to answer "what do we know about X": a single keyless search across ' +
      'every subsystem — clients, contacts, documents, tasks, campaigns, customers, and ' +
      'activities. Returns a ranked list of hits, each with a type, id, title, snippet, ' +
      'and url, plus counts_by_type across all matches (even beyond the returned page). ' +
      'Use this before reaching for a subsystem-specific tool when you don\'t yet know ' +
      'where the answer lives.',
    inputSchema: {
      query: z.string().min(1).describe('The search text (matched case-insensitively).'),
      client_id: clientIdField,
      limit: limitField.describe('Max hits to return (default 30).'),
      organization_id: organizationIdField,
    },
  },
  async ({ query, client_id, limit, organization_id }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const result = await searchEverything(orgId, query, { clientId: client_id, limit })
      return ok(result)
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'create_conversation',
  {
    title: 'Create conversation',
    description:
      'Start a new conversation thread to hold memory across turns. Returns the created ' +
      'conversation. Use add_message afterward to append turns to it.',
    inputSchema: {
      title: z.string().optional().describe('Optional human-readable title for the thread.'),
      organization_id: organizationIdField,
    },
  },
  async ({ title, organization_id }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const conversation = await createConversation(orgId, { title })
      return ok({ conversation })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'list_conversations',
  {
    title: 'List conversations',
    description:
      'List conversation threads for the organization, most recently active first ' +
      '(ordered by updated_at desc). Use this to find an existing thread to resume.',
    inputSchema: {
      limit: limitField.describe('Max rows (default all).'),
      organization_id: organizationIdField,
    },
  },
  async ({ limit, organization_id }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const conversations = await listConversations(orgId, { limit })
      return ok({ conversations })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'get_conversation',
  {
    title: 'Get conversation',
    description:
      'Fetch a single conversation thread and its full message history (ordered oldest ' +
      'first), so an agent can resume a prior thread with full context.',
    inputSchema: {
      conversation_id: conversationIdField,
      organization_id: organizationIdField,
    },
  },
  async ({ conversation_id, organization_id }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const conversation = await getConversation(orgId, conversation_id)
      if (!conversation) throw new Error(`No conversation found for id ${conversation_id}`)
      const messages = await listConversationMessages(orgId, conversation_id)
      return ok({ conversation, messages })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'add_message',
  {
    title: 'Add message',
    description:
      'Append a turn to a conversation (role user/assistant/system, plus content and ' +
      'optional citations back to search_everything hits). Also bumps the conversation\'s ' +
      'updated_at so it surfaces first in list_conversations.',
    inputSchema: {
      conversation_id: conversationIdField,
      role: z.enum(['user', 'assistant', 'system']).describe('Who said this turn.'),
      content: z.string().min(1).describe('The message text.'),
      citations: z
        .array(z.unknown())
        .optional()
        .describe('Optional array of citations (e.g. search_everything hits) backing this message.'),
      organization_id: organizationIdField,
    },
  },
  async ({ conversation_id, role, content, citations, organization_id }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const message = await addMessage(orgId, { conversation_id, role, content, citations })
      return ok({ message })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerResource(
  'conversation',
  new ResourceTemplate('conversation://{id}', { list: undefined }),
  {
    title: 'Conversation',
    description:
      'A conversation thread and its full message history, as JSON. Resolve the org via ' +
      'the server default (RETENTIONOS_ORG_ID) — this resource does not take an ' +
      'organization override.',
    mimeType: 'application/json',
  },
  async (uri, { id }) => {
    const conversationId = Array.isArray(id) ? id[0] : id
    if (!conversationId) throw new Error('conversation:// resource requires a non-empty id.')
    const orgId = await resolveOrg()
    const conversation = await getConversation(orgId, conversationId)
    if (!conversation) throw new Error(`No conversation found for id ${conversationId}`)
    const messages = await listConversationMessages(orgId, conversationId)
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify({ conversation, messages }, null, 2),
        },
      ],
    }
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
console.error('retentionos-backbone MCP server running on stdio')
