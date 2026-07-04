#!/usr/bin/env tsx
// CRM MCP server — the "works with any model" layer (docs/04-ai-and-agent-layer.md).
//
// Exposes the full CRM tool surface (list/get/search/create/update clients, contacts,
// notes, channels) over stdio, backed by @retentionos/db — the SAME data-access layer
// the web app uses. So the same tools work from Claude Desktop/Code and from an OpenAI
// Agents-SDK caller, against the same owned Postgres.
//
// Tenant-safety: this server talks to Postgres directly (no RLS), so it MUST scope every
// query by organization_id itself. It never becomes a backdoor around tenancy — every
// tool resolves its org via resolveOrg() before touching the database.

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  getDefaultOrganization,
  listClients,
  getClient,
  searchClients,
  createClient,
  updateClient,
  listContacts,
  linkChannel,
  createDocument,
  logActivity,
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

const clientIdField = z.string().uuid().describe('The client account id (UUID).')

const server = new McpServer({
  name: 'retentionos-crm',
  version: '0.2.0',
})

server.registerTool(
  'list_clients',
  {
    title: 'List clients',
    description:
      'List client accounts for an organization, optionally filtered by status. ' +
      'Returns each client with id, name, status, tier, lifecycle_stage, and other fields. ' +
      'Use this to browse the client roster; use search_clients to find a client by name.',
    inputSchema: {
      organization_id: organizationIdField,
      status: z
        .enum(['prospect', 'onboarding', 'active', 'at_risk', 'churned', 'paused'])
        .optional()
        .describe('Optional status filter.'),
      limit: z.number().int().min(1).max(200).optional().describe('Max rows (default 50).'),
    },
  },
  async ({ organization_id, status, limit }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const clients = await listClients(orgId, { status, limit: limit ?? 50 })
      return ok({ clients })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'get_client',
  {
    title: 'Get client',
    description:
      'Fetch a single client account by id, including status, tier, lifecycle_stage, ' +
      'health_score, website, industry, and contract dates. Reports if no client with ' +
      'that id exists in the organization.',
    inputSchema: {
      client_id: clientIdField,
      organization_id: organizationIdField,
    },
  },
  async ({ client_id, organization_id }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const client = await getClient(orgId, client_id)
      if (!client) return ok({ found: false, message: `No client found with id ${client_id}.` })
      return ok({ found: true, client })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'search_clients',
  {
    title: 'Search clients',
    description:
      'Free-text search for client accounts by name or industry (case-insensitive, ' +
      'substring match). Use this when you have a partial or approximate client name ' +
      'rather than an exact id.',
    inputSchema: {
      query: z.string().min(1).describe('Text to search for in client name or industry.'),
      organization_id: organizationIdField,
      limit: z.number().int().min(1).max(200).optional().describe('Max rows (default 20).'),
    },
  },
  async ({ query, organization_id, limit }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const clients = await searchClients(orgId, query, limit ?? 20)
      return ok({ clients })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'list_contacts',
  {
    title: 'List contacts',
    description:
      'List the contacts (people) associated with a client account, primary contact ' +
      'first. Returns full_name, email, phone, title, and role_type for each.',
    inputSchema: {
      client_id: clientIdField,
      organization_id: organizationIdField,
    },
  },
  async ({ client_id, organization_id }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const contacts = await listContacts(orgId, client_id)
      return ok({ contacts })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'create_client',
  {
    title: 'Create client',
    description:
      'Create a new client account in the CRM. Only `name` is required; status defaults ' +
      'to "prospect" and tier defaults to "standard". Logs a client.created activity.',
    inputSchema: {
      name: z.string().min(1).describe('Client account / company name.'),
      status: z
        .enum(['prospect', 'onboarding', 'active', 'at_risk', 'churned', 'paused'])
        .optional()
        .describe('Initial status. Defaults to "prospect".'),
      tier: z
        .enum(['standard', 'premium', 'enterprise'])
        .optional()
        .describe('Account tier. Defaults to "standard".'),
      website: z.string().optional().describe('Client website URL.'),
      industry: z.string().optional().describe('Client industry, e.g. "coffee", "retail".'),
      organization_id: organizationIdField,
    },
  },
  async ({ name, status, tier, website, industry, organization_id }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const client = await createClient(orgId, { name, status, tier, website, industry })
      await logActivity(orgId, {
        client_id: client.id,
        actor_type: 'agent',
        verb: 'client.created',
        summary: `Created client "${client.name}"`,
        data: { name, status, tier, website, industry },
      })
      return ok({ client })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'update_client',
  {
    title: 'Update client',
    description:
      'Update fields on an existing client account (status, lifecycle_stage, tier, ' +
      'health_score, website, industry). Only the fields you provide are changed; ' +
      'omitted fields are left as-is. Logs a client.updated activity with the changed fields.',
    inputSchema: {
      client_id: clientIdField,
      status: z
        .enum(['prospect', 'onboarding', 'active', 'at_risk', 'churned', 'paused'])
        .optional()
        .describe('New status.'),
      lifecycle_stage: z
        .enum(['lead', 'trial', 'active', 'renewal', 'offboarding'])
        .optional()
        .describe('New lifecycle stage.'),
      tier: z.enum(['standard', 'premium', 'enterprise']).optional().describe('New tier.'),
      health_score: z.number().min(0).max(100).optional().describe('New health score (0-100).'),
      website: z.string().optional().describe('New website URL.'),
      industry: z.string().optional().describe('New industry.'),
      organization_id: organizationIdField,
    },
  },
  async ({
    client_id,
    status,
    lifecycle_stage,
    tier,
    health_score,
    website,
    industry,
    organization_id,
  }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const patch: Record<string, unknown> = {}
      if (status !== undefined) patch.status = status
      if (lifecycle_stage !== undefined) patch.lifecycle_stage = lifecycle_stage
      if (tier !== undefined) patch.tier = tier
      if (health_score !== undefined) patch.health_score = health_score
      if (website !== undefined) patch.website = website
      if (industry !== undefined) patch.industry = industry

      const client = await updateClient(orgId, client_id, patch)
      if (!client) return ok({ found: false, message: `No client found with id ${client_id}.` })

      await logActivity(orgId, {
        client_id: client.id,
        actor_type: 'agent',
        verb: 'client.updated',
        summary: `Updated client "${client.name}"`,
        data: patch,
      })
      return ok({ client })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'add_note',
  {
    title: 'Add note',
    description:
      'Attach a freeform note document to a client account (e.g. a call summary or ' +
      'meeting recap). Logs a note.created activity so it shows up in the client timeline.',
    inputSchema: {
      client_id: clientIdField,
      title: z.string().min(1).describe('Short title for the note.'),
      content: z.string().optional().describe('Note body text.'),
      organization_id: organizationIdField,
    },
  },
  async ({ client_id, title, content, organization_id }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const document = await createDocument(orgId, {
        client_id,
        title,
        source: 'note',
        content,
      })
      await logActivity(orgId, {
        client_id,
        actor_type: 'agent',
        verb: 'note.created',
        summary: `Added note "${title}"`,
        data: { document_id: document.id, title },
      })
      return ok({ document })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'link_channel',
  {
    title: 'Link channel',
    description:
      'Link a communication or storage channel (Slack, Google Drive, Google Calendar, ' +
      'Notion, Airtable, website, or other) to a client account. Logs a channel.linked ' +
      'activity.',
    inputSchema: {
      client_id: clientIdField,
      kind: z
        .enum(['slack', 'gdrive', 'gcal', 'notion', 'airtable', 'website', 'other'])
        .describe('Type of channel being linked.'),
      name: z.string().min(1).describe('Display name for the channel, e.g. "#acme-support".'),
      url: z.string().optional().describe('URL to the channel/resource, if applicable.'),
      organization_id: organizationIdField,
    },
  },
  async ({ client_id, kind, name, url, organization_id }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const channel = await linkChannel(orgId, { client_id, kind, name, url })
      await logActivity(orgId, {
        client_id,
        actor_type: 'agent',
        verb: 'channel.linked',
        summary: `Linked ${kind} channel "${name}"`,
        data: { channel_id: channel.id, kind, name, url },
      })
      return ok({ channel })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerResource(
  'client',
  new ResourceTemplate('client://{id}', { list: undefined }),
  {
    title: 'Client account',
    description:
      'A single CRM client account, as JSON. Resolve the org via the server default ' +
      '(RETENTIONOS_ORG_ID) — this resource does not take an organization override.',
    mimeType: 'application/json',
  },
  async (uri, { id }) => {
    const clientId = Array.isArray(id) ? id[0] : id
    if (!clientId) throw new Error('client:// resource requires a non-empty id.')
    const orgId = await resolveOrg()
    const client = await getClient(orgId, clientId)
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(client ?? { found: false, message: `No client found with id ${clientId}.` }, null, 2),
        },
      ],
    }
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
console.error('retentionos-crm MCP server running on stdio')
