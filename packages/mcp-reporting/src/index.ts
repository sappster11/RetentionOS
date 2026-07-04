#!/usr/bin/env tsx
// Reporting MCP server — the "speak the numbers" layer (docs/04-ai-and-agent-layer.md).
//
// Exposes the derived reporting tool surface (portfolio overview, client health, at-risk
// clients, retention metrics by client) over stdio, backed by @retentionos/db — the SAME
// data-access layer the web app uses. So the same tools work from Claude Desktop/Code and
// from an OpenAI Agents-SDK caller, against the same owned Postgres.
//
// Mostly read-only: every tool reads clients / client_customers / client_customer_metrics
// / tasks. The one exception is refresh_health_scores, which recomputes and persists
// health_score for every client in the org (and logs the recompute as an activity) — see
// its description below.
//
// Tenant-safety: this server talks to Postgres directly (no RLS), so it MUST scope every
// query by organization_id itself. It never becomes a backdoor around tenancy — every
// tool resolves its org via resolveOrg() before touching the database.

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  getDefaultOrganization,
  portfolioOverview,
  clientHealth,
  atRiskClients,
  retentionMetricsByClient,
  computeHealthScores,
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
  name: 'retentionos-reporting',
  version: '0.1.0',
})

server.registerTool(
  'portfolio_overview',
  {
    title: 'Portfolio overview',
    description:
      'The "how\'s the whole book of business" summary: client count, total customers, ' +
      'total revenue, average health score, at-risk client count, and campaign count ' +
      'across every non-archived client in the org. Start here for a top-level rollup.',
    inputSchema: {
      organization_id: organizationIdField,
    },
  },
  async ({ organization_id }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const overview = await portfolioOverview(orgId)
      return ok({ overview })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'client_health',
  {
    title: 'Client health',
    description:
      'The current stored health_score for one client, plus a fresh explanation of what\'s ' +
      'driving it (active/churn/at-risk lifecycle shares, overdue-task count) and its ' +
      'lifecycle-stage customer counts. Use this to answer "why is this client\'s health ' +
      'score what it is".',
    inputSchema: {
      client_id: clientIdField,
      organization_id: organizationIdField,
    },
  },
  async ({ client_id, organization_id }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const health = await clientHealth(orgId, client_id)
      if (!health) throw new Error(`No client found for client_id ${client_id}.`)
      return ok({ health })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'at_risk_clients',
  {
    title: 'At-risk clients',
    description:
      'Which clients need attention right now and why: every client whose CRM status is ' +
      'at_risk or whose health score has dropped below 40, each with a short human-readable ' +
      'reason (status, health score, at-risk/churned customer counts). Worst health first.',
    inputSchema: {
      organization_id: organizationIdField,
    },
  },
  async ({ organization_id }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const clients = await atRiskClients(orgId)
      return ok({ clients })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'retention_metrics',
  {
    title: 'Retention metrics by client',
    description:
      'Per-client retention snapshot: customer count, revenue, active/at-risk/churn ' +
      'percentages, and current health score — the row shape a "retention by client" ' +
      'table/report wants. Ordered by client name.',
    inputSchema: {
      organization_id: organizationIdField,
    },
  },
  async ({ organization_id }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const metrics = await retentionMetricsByClient(orgId)
      return ok({ metrics })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'refresh_health_scores',
  {
    title: 'Refresh health scores',
    description:
      'Recomputes and PERSISTS health_score for every non-archived client in the org, from ' +
      'each client\'s current lifecycle distribution and overdue tasks, and returns the ' +
      'updated per-client scores + drivers. This is the one mutating tool here — it writes ' +
      'to clients.health_score and logs a reporting.recomputed activity. Run it before ' +
      'reading portfolio_overview / at_risk_clients / retention_metrics if the data has ' +
      'changed recently and you need current numbers rather than the last-computed ones.',
    inputSchema: {
      organization_id: organizationIdField,
    },
  },
  async ({ organization_id }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const scores = await computeHealthScores(orgId)
      await logActivity(orgId, {
        client_id: null,
        actor_type: 'agent',
        verb: 'reporting.recomputed',
        summary: `Recomputed health scores for ${scores.length} client(s)`,
        data: { count: scores.length },
      })
      return ok({ scores })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'run_report',
  {
    title: 'Run report',
    description:
      'Convenience umbrella so an agent can ask for a named report by string instead of ' +
      'picking the specific tool: report="portfolio" -> portfolio_overview, ' +
      'report="at_risk" -> at_risk_clients, report="retention" -> retention_metrics. Same ' +
      'underlying reads as calling those tools directly.',
    inputSchema: {
      report: z
        .enum(['portfolio', 'at_risk', 'retention'])
        .describe('Which named report to run: "portfolio", "at_risk", or "retention".'),
      organization_id: organizationIdField,
    },
  },
  async ({ report, organization_id }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      switch (report) {
        case 'portfolio':
          return ok({ report, overview: await portfolioOverview(orgId) })
        case 'at_risk':
          return ok({ report, clients: await atRiskClients(orgId) })
        case 'retention':
          return ok({ report, metrics: await retentionMetricsByClient(orgId) })
      }
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerResource(
  'portfolio',
  new ResourceTemplate('report://portfolio', { list: undefined }),
  {
    title: 'Portfolio overview report',
    description:
      'The org-wide portfolio overview (client count, customers, revenue, avg health, ' +
      'at-risk count, campaigns), as JSON. Resolves the org via the server default ' +
      '(RETENTIONOS_ORG_ID) — this resource does not take an organization override.',
    mimeType: 'application/json',
  },
  async (uri) => {
    const orgId = await resolveOrg()
    const overview = await portfolioOverview(orgId)
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
console.error('retentionos-reporting MCP server running on stdio')
