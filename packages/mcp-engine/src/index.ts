#!/usr/bin/env tsx
// Generic engine MCP server — Phase C's agent surface (docs/08-course-correction.md,
// decision 6). ONE server replaces the six parked domain servers: it exposes the whole
// meta-schema engine (tables/fields/records/views/revisions) as tools over stdio, backed
// by @retentionos/engine — the SAME service layer the web UI calls (agent-parity law).
//
// Env:
//   DATABASE_URL        (required) Postgres connection string.
//   RETENTIONOS_ORG_ID  (optional) org to scope to; defaults to the first org in the DB.
//   ROS_AGENT_ID        (optional) actor id written to the audit trail (default "mcp-engine").

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { buildServer } from './server'

if (!process.env.DATABASE_URL) {
  // @retentionos/db's pool throws lazily on first query if this is unset — fail fast
  // here instead, with a message that points at the fix.
  console.error('Missing DATABASE_URL. See .env.example / docs/LOCAL_DEV.md.')
  process.exit(1)
}

const server = buildServer()
const transport = new StdioServerTransport()
await server.connect(transport)
console.error('retentionos-engine MCP server running on stdio')
