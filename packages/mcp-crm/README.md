# @retentionos/mcp-crm

The CRM Model Context Protocol server. Same tools, every agent — this is the "works with any
model" layer in practice (docs/04-ai-and-agent-layer.md).

Backed by `@retentionos/db`, the same shared data-access layer the web app uses, talking to the
owned Postgres via `DATABASE_URL`.

## Tools

- `list_clients` — list client accounts, optionally filtered by `status`.
- `get_client` — fetch a single client account by id.
- `search_clients` — free-text search over client name/industry.
- `list_contacts` — list the contacts (people) for a client.
- `create_client` — create a new client account. Logs a `client.created` activity.
- `update_client` — patch status/lifecycle_stage/tier/health_score/website/industry on a
  client. Logs a `client.updated` activity with the changed fields.
- `add_note` — attach a freeform note document to a client. Logs a `note.created` activity.
- `link_channel` — link a Slack/Drive/Calendar/Notion/Airtable/website/other channel to a
  client. Logs a `channel.linked` activity.

Every tool takes an optional `organization_id`; when omitted it resolves to
`RETENTIONOS_ORG_ID`, then the first organization in the database. This keeps every call
tenant-scoped even when this server bypasses row-level security.

## Resources

- `client://{id}` — a single client account as JSON.

## Run it

```bash
# needs DATABASE_URL (and optionally RETENTIONOS_ORG_ID to pin a default org)
pnpm --filter @retentionos/mcp-crm start
```

## Connect from Claude Desktop
Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "retentionos-crm": {
      "command": "pnpm",
      "args": ["--filter", "@retentionos/mcp-crm", "start"],
      "env": {
        "DATABASE_URL": "postgresql://ros:ros@127.0.0.1:5432/retentionos",
        "RETENTIONOS_ORG_ID": "…"
      }
    }
  }
}
```

## Connect from OpenAI
OpenAI's Agents SDK supports MCP servers directly (point it at this stdio command), or wrap the
tool as an OpenAI function tool via a thin adapter. Either way it calls the **same** tools —
one CRM tool surface, driven from two vendors.
