# @retentionos/mcp-engine

The generic engine MCP server — Phase C's agent surface (docs/08-course-correction.md,
decision 6). One server exposes the **whole meta-schema engine** as tools over stdio:
tables, fields (all types incl. linked records, lookups, rollups, formulas), records,
views, and the per-record revision/audit trail. It is a thin wrapper over
`@retentionos/engine` — the same service layer the web UI calls — so anything a human can
do by clicking, an agent can do by tool call (agent-parity law).

## Tools

| Tool | What it does |
|------|--------------|
| `list_bases` | All bases (workspace groupings of tables, e.g. "Sales CRM" / "Client Hub") |
| `create_base` | Create a base; put tables in it via `create_table`'s `base` argument |
| `list_tables` | All tables in the org (with `base_id`/`base_name`), optionally filtered to one base |
| `describe_table` | One table's full schema: fields (ids, types, options, choice ids), views |
| `create_table` / `update_table` / `delete_table` | Table lifecycle (`create_table` takes an optional `base`; `update_table` moves a table with `base` or ungroups it with `clear_base`) |
| `create_field` / `update_field` / `delete_field` | Field lifecycle (linked_record auto-creates its inverse) |
| `query_records` | Filter/sort/paginate; returns raw `values` + computed `display` maps |
| `get_record` | One record (+ optional revision history) |
| `create_record` / `update_record` / `delete_records` | Record writes (validated, audited) |
| `list_views` / `create_view` / `update_view` / `delete_view` | Grid/kanban views |
| `list_revisions` | Per-record audit trail with human/agent/api attribution |

Values are keyed by **field id** (get them from `describe_table`). Percent values are 0-1
fractions. Formulas use `{fld:FIELD_ID}` tokens. Computed fields are read-only.

## Environment

| Var | Required | Meaning |
|-----|----------|---------|
| `DATABASE_URL` | yes | Postgres connection string (same one the web app uses) |
| `RETENTIONOS_ORG_ID` | no | Pin the server to one org. When set, a per-call `organization_id` that differs is rejected (`forbidden`); when unset, tools default to the first org in the DB and accept per-call overrides |
| `ROS_AGENT_ID` | no | Actor id written to the audit trail (default `mcp-engine`) — set per agent so attribution stays distinguishable |

## Security note

This server is a **pre-auth, single-tenant design**: there is no per-call authentication —
anything that can reach the stdio transport gets full read/write access to the database it
points at. Tenant scoping is by convention, not enforcement, unless you pin the server to
one org via `RETENTIONOS_ORG_ID` (then per-call `organization_id` overrides that differ
are rejected with `forbidden`). Run it only as a local stdio child of a client you trust
(Claude Code / Claude Desktop); **do not expose it beyond local stdio** (no TCP/HTTP
bridges, no shared hosts) until real auth lands.

## Run it

```sh
pnpm --filter @retentionos/mcp-engine start   # or, from the repo root: pnpm mcp:engine
```

### Claude Code

```sh
claude mcp add retentionos-engine \
  --env DATABASE_URL="postgres://USER:PASS@localhost:5432/retentionos" \
  --env ROS_AGENT_ID="claude-code" \
  -- npx tsx /ABSOLUTE/PATH/TO/RetentionOS/packages/mcp-engine/src/index.ts
```

### Claude Desktop

Add to `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "retentionos-engine": {
      "command": "npx",
      "args": ["tsx", "/ABSOLUTE/PATH/TO/RetentionOS/packages/mcp-engine/src/index.ts"],
      "env": {
        "DATABASE_URL": "postgres://USER:PASS@localhost:5432/retentionos",
        "ROS_AGENT_ID": "claude-desktop"
      }
    }
  }
}
```

macOS note: Claude Desktop does not inherit your shell's PATH, so under nvm you may need
an absolute `command` (e.g. `~/.nvm/versions/node/v22.x.x/bin/npx`, or run
`which npx` and paste the result).

## Tests

`pnpm --filter @retentionos/mcp-engine test` — boots an embedded Postgres (port 54331),
runs the tool handlers directly (schema build → linked/percent/formula fields → records →
filtered query → update → audit trail → cleanup), then spawns the real server over stdio
and drives an initialize → tools/list → tools/call round-trip with the MCP SDK client.
