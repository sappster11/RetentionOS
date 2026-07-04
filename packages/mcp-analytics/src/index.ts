#!/usr/bin/env tsx
// Analytics MCP server — the "works with any model" layer (docs/04-ai-and-agent-layer.md).
//
// Exposes the derived retention analytics tool surface (retention overview, lifecycle
// segments, RFM/customer metrics, cohort retention, product performance) over stdio, backed
// by @retentionos/db — the SAME data-access layer the web app uses. So the same tools work
// from Claude Desktop/Code and from an OpenAI Agents-SDK caller, against the same owned
// Postgres.
//
// Read-only: every tool here only reads client_customers / client_customer_metrics /
// client_cohorts / client_products (+ order items). Nothing here writes.
//
// Tenant-safety: this server talks to Postgres directly (no RLS), so it MUST scope every
// query by organization_id itself. It never becomes a backdoor around tenancy — every
// tool resolves its org via resolveOrg() before touching the database.

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  getDefaultOrganization,
  getRetentionOverview,
  listSegmentCustomers,
  getCustomerMetrics,
  getCohorts,
  getProductPerformance,
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

const limitField = z.number().int().min(1).max(500).optional()

const server = new McpServer({
  name: 'retentionos-analytics',
  version: '0.1.0',
})

server.registerTool(
  'client_retention_overview',
  {
    title: 'Client retention overview',
    description:
      'The "how healthy is this client\'s retention" summary: total customers, total ' +
      'revenue, average AOV, and a breakdown of customer counts by lifecycle stage ' +
      '(new/active/at_risk/churned/won_back/vip). Start here before drilling into a segment.',
    inputSchema: {
      client_id: clientIdField,
      organization_id: organizationIdField,
    },
  },
  async ({ client_id, organization_id }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const overview = await getRetentionOverview(orgId, client_id)
      return ok({ overview })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'list_segment',
  {
    title: 'List segment customers',
    description:
      'List the customers currently in a given lifecycle-stage segment, richest ' +
      '(highest monetary RFM score) first. Use segment="at_risk" or "churned" to find ' +
      '"who to win back", and segment="vip" to find "who are the VIPs".',
    inputSchema: {
      client_id: clientIdField,
      segment: z
        .enum(['new', 'active', 'at_risk', 'churned', 'won_back', 'vip'])
        .describe('Lifecycle-stage segment to list customers for.'),
      organization_id: organizationIdField,
      limit: limitField.describe('Max rows (default 100).'),
    },
  },
  async ({ client_id, segment, organization_id, limit }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const customers = await listSegmentCustomers(orgId, client_id, segment, limit ?? 100)
      return ok({ segment, customers })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'customer_metrics',
  {
    title: 'Customer metrics',
    description:
      'The latest computed RFM (recency/frequency/monetary), lifecycle_stage, and ' +
      'churn_risk row per customer for a client, highest spend first. Use this for a ' +
      'detailed per-customer view rather than the segment-level list_segment tool.',
    inputSchema: {
      client_id: clientIdField,
      organization_id: organizationIdField,
      limit: limitField.describe('Max rows (default all).'),
    },
  },
  async ({ client_id, organization_id, limit }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const metrics = await getCustomerMetrics(orgId, client_id, { limit })
      return ok({ metrics })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'cohort_retention',
  {
    title: 'Cohort retention',
    description:
      'Monthly acquisition-cohort retention rows for a client: customers, retained, and ' +
      'revenue per cohort per period_index (months since acquisition, 0-12). Ordered for ' +
      'charting (cohort_key asc, period_index asc). Use this to answer "how well do we ' +
      'retain customers acquired in a given month".',
    inputSchema: {
      client_id: clientIdField,
      organization_id: organizationIdField,
    },
  },
  async ({ client_id, organization_id }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const cohorts = await getCohorts(orgId, client_id)
      return ok({ cohorts })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'product_performance',
  {
    title: 'Product performance',
    description:
      'Top products for a client by revenue, with units sold. Use this to answer ' +
      '"what are our best-selling / highest-revenue products".',
    inputSchema: {
      client_id: clientIdField,
      organization_id: organizationIdField,
      limit: limitField.describe('Max rows (default 20).'),
    },
  },
  async ({ client_id, organization_id, limit }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const products = await getProductPerformance(orgId, client_id, { limit })
      return ok({ products })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerResource(
  'retention',
  new ResourceTemplate('retention://{clientId}', { list: undefined }),
  {
    title: 'Client retention overview',
    description:
      'The retention overview (totals + lifecycle-stage breakdown) for a single client, ' +
      'as JSON. Resolve the org via the server default (RETENTIONOS_ORG_ID) — this ' +
      'resource does not take an organization override.',
    mimeType: 'application/json',
  },
  async (uri, { clientId }) => {
    const id = Array.isArray(clientId) ? clientId[0] : clientId
    if (!id) throw new Error('retention:// resource requires a non-empty clientId.')
    const orgId = await resolveOrg()
    const overview = await getRetentionOverview(orgId, id)
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(overview, null, 2),
        },
      ],
    }
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
console.error('retentionos-analytics MCP server running on stdio')
