// Builds the McpServer from the tool definitions in tools.ts. Kept separate from the
// stdio entry (index.ts) so tests can construct a server (or call tool handlers
// directly) without touching a transport.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { tools } from './tools'

const INSTRUCTIONS = `RetentionOS engine — an Airtable-class database where tables, fields,
records, links, and views are all created at runtime through these tools (the same service
layer the web UI uses, so anything a human can click, you can call).

Standard workflow: list_tables → describe_table (gives every field's id, type, and options,
including select choice ids and linked table ids) → then read/write. Record values are
ALWAYS keyed by field id (uuid), never by field name. Percent values are 0-1 fractions.
Formula expressions reference fields as {fld:FIELD_ID}. Computed field types (formula,
lookup, rollup, autonumber, created_time, last_modified_time) are read-only. Every mutation
you make is recorded in the per-record audit trail with agent attribution — see
list_revisions, which is also where stage-change history lives.`

export function buildServer(): McpServer {
  const server = new McpServer(
    { name: 'retentionos-engine', version: '0.1.0' },
    { instructions: INSTRUCTIONS },
  )
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema },
      (args: Record<string, unknown>) => tool.run(args),
    )
  }
  return server
}
