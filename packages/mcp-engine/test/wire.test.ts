// Wire-level smoke test: spawn the real server over stdio (exactly how Claude Code /
// Claude Desktop launch it) with the MCP SDK's own client, and drive one full round-trip:
// initialize → tools/list → tools/call. Proves the transport, registration, and JSON
// shapes — the behavioral depth lives in tools.test.ts.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { queryOne } from '@retentionos/db'
import { createTable } from '@retentionos/engine'

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..')

const EXPECTED_TOOLS = [
  'list_tables',
  'describe_table',
  'create_table',
  'update_table',
  'delete_table',
  'create_field',
  'update_field',
  'delete_field',
  'query_records',
  'get_record',
  'create_record',
  'update_record',
  'delete_records',
  'list_views',
  'create_view',
  'update_view',
  'delete_view',
  'list_revisions',
]

let client: Client
let orgId: string

beforeAll(async () => {
  // Seed an org + table in the shared embedded Postgres so the spawned server (which
  // resolves the default org itself) has something real to list.
  const slug = `mcp-wire-test-${Math.random().toString(36).slice(2, 8)}`
  const row = await queryOne<{ id: string }>(
    `insert into public.organizations (name, slug) values ($1, $2) returning id`,
    ['MCP Wire Test Org', slug],
  )
  if (!row) throw new Error('Failed to create wire-test org')
  orgId = row.id
  await createTable(orgId, { name: 'Wire Smoke' }, { type: 'agent', id: 'wire-test-seed' })

  const transport = new StdioClientTransport({
    command: join(pkgDir, 'node_modules', '.bin', 'tsx'),
    args: ['src/index.ts'],
    cwd: pkgDir,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      DATABASE_URL: process.env.DATABASE_URL ?? '',
      // Pin the spawned server to the wire-test org; per-call organization_id overrides
      // below make each assertion explicit anyway.
      RETENTIONOS_ORG_ID: orgId,
    },
  })
  client = new Client({ name: 'wire-smoke-client', version: '0.0.0' })
  await client.connect(transport)
}, 60000)

afterAll(async () => {
  await client?.close()
})

describe('mcp-engine over stdio', () => {
  it('initialize handshake reports the server identity', () => {
    expect(client.getServerVersion()?.name).toBe('retentionos-engine')
  })

  it('tools/list exposes the full engine surface', async () => {
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name)
    for (const expected of EXPECTED_TOOLS) expect(names).toContain(expected)
    const create = tools.find((t) => t.name === 'create_field')!
    // Tool descriptions must carry the operating knowledge (formula tokens etc.).
    expect(create.description).toContain('{fld:')
    expect(create.inputSchema).toMatchObject({ type: 'object' })
  })

  it('tools/call list_tables round-trips real data', async () => {
    const result = (await client.callTool({
      name: 'list_tables',
      arguments: { organization_id: orgId },
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> }
    expect(result.isError).toBeFalsy()
    expect(result.content[0]!.type).toBe('text')
    const payload = JSON.parse(result.content[0]!.text)
    expect(payload.tables.some((t: { name: string }) => t.name === 'Wire Smoke')).toBe(true)
  })

  it('tools/call maps engine errors with the code intact', async () => {
    const result = (await client.callTool({
      name: 'describe_table',
      arguments: { table: 'does-not-exist', organization_id: orgId },
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> }
    expect(result.isError).toBe(true)
    const payload = JSON.parse(result.content[0]!.text)
    expect(payload.error.code).toBe('not_found')
  })
})
