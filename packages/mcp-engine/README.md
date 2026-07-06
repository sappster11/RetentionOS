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
| `list_tables` | All tables in the org |
| `describe_table` | One table's full schema: fields (ids, types, options, choice ids), views |
| `create_table` / `update_table` / `delete_table` | Table lifecycle |
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
| `RETENTIONOS_ORG_ID` | no | Org to scope to; defaults to the first org in the DB |
| `ROS_AGENT_ID` | no | Actor id written to the audit trail (default `mcp-engine`) — set per agent so attribution stays distinguishable |

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

## Tests

`pnpm --filter @retentionos/mcp-engine test` — boots an embedded Postgres (port 54331),
runs the tool handlers directly (schema build → linked/percent/formula fields → records →
filtered query → update → audit trail → cleanup), then spawns the real server over stdio
and drives an initialize → tools/list → tools/call round-trip with the MCP SDK client.
