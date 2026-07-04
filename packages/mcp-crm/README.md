# @retentionos/mcp-crm

The CRM Model Context Protocol server. Same tools, every agent — this is the "works with any
model" layer in practice (docs/04-ai-and-agent-layer.md).

**Phase 0:** one read tool, `list_clients` (returns `[]` until Phase 1 creates the `clients` table).
**Phase 1:** grows into full CRUD + `search_clients` + `add_note` + `link_channel`, each tenant-safe
and writing an `activities` audit row.

## Run it

```bash
# needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RETENTIONOS_ORG_ID
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
        "NEXT_PUBLIC_SUPABASE_URL": "https://YOUR-PROJECT.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "…",
        "RETENTIONOS_ORG_ID": "…"
      }
    }
  }
}
```

## Connect from OpenAI
OpenAI's Agents SDK supports MCP servers directly (point it at this stdio command), or wrap the
tool as an OpenAI function tool via a thin adapter. Either way it calls the **same** `list_clients`
— which is the Phase 0 acceptance test: one tool, driven from two vendors.
