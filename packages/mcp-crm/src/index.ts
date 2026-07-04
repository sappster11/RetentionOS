#!/usr/bin/env tsx
// CRM MCP server (Phase 0 skeleton — task 0.6).
//
// Exposes one read tool, `list_clients`, over stdio so the SAME tool works from Claude
// Desktop/Code AND from an OpenAI Agents-SDK caller. Phase 1 fleshes this into the full
// CRM tool surface (get_client, search_clients, create_client, add_note, link_channel…).
//
// Tenant-safety: this server uses the service-role key (bypasses RLS), so it MUST scope
// every query by organization_id itself. It never becomes a backdoor around tenancy.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
// The org this server operates within. In-app runtime derives this from the authed
// session; for the stdio skeleton it's provided by env (or per-tool override).
const DEFAULT_ORG_ID = process.env.RETENTIONOS_ORG_ID

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. See .env.example.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const server = new McpServer({
  name: 'retentionos-crm',
  version: '0.1.0',
})

server.registerTool(
  'list_clients',
  {
    title: 'List clients',
    description:
      'List client accounts for an organization, optionally filtered by status. ' +
      'Returns id, name, status, tier, and lifecycle_stage for each client.',
    inputSchema: {
      organization_id: z
        .string()
        .uuid()
        .optional()
        .describe('Organization to scope to. Defaults to the server RETENTIONOS_ORG_ID.'),
      status: z
        .enum(['prospect', 'onboarding', 'active', 'at_risk', 'churned', 'paused'])
        .optional()
        .describe('Optional status filter.'),
      limit: z.number().int().min(1).max(200).optional().describe('Max rows (default 50).'),
    },
  },
  async ({ organization_id, status, limit }) => {
    const orgId = organization_id ?? DEFAULT_ORG_ID
    if (!orgId) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'No organization_id provided and RETENTIONOS_ORG_ID is not set.',
          },
        ],
      }
    }

    let query = supabase
      .from('clients')
      .select('id, name, status, tier, lifecycle_stage')
      .eq('organization_id', orgId)
      .order('name', { ascending: true })
      .limit(limit ?? 50)

    if (status) query = query.eq('status', status)

    const { data, error } = await query

    // Phase 0: the `clients` table doesn't exist until Phase 1. Degrade gracefully so
    // the end-to-end MCP path is still demonstrable now.
    if (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { clients: [], note: `Query failed (expected until Phase 1): ${error.message}` },
              null,
              2,
            ),
          },
        ],
      }
    }

    return {
      content: [{ type: 'text', text: JSON.stringify({ clients: data ?? [] }, null, 2) }],
    }
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
console.error('retentionos-crm MCP server running on stdio')
