# @retentionos/mcp-backbone

The Backbone Model Context Protocol server — the retrieval + memory backbone for
chat-with-everything (Phase 6, docs/04-ai-and-agent-layer.md). Same tools, every agent —
this is the "works with any model" layer in practice.

Backed by `@retentionos/db`, the same shared data-access layer the web app uses, talking to the
owned Postgres via `DATABASE_URL`. This server does no reasoning of its own and makes no LLM
call — the agent host (Claude Desktop, etc.) reasons over the hits and history this server
returns. It only retrieves and remembers.

## Tools

- `search_everything` — the one tool to answer "what do we know about X": a single keyless
  search across every subsystem — clients, contacts, documents, tasks, campaigns, customers,
  and activities. Returns hits (each with a `type`, `id`, `title`, `snippet`, `url`) plus
  `counts_by_type` across all matches.
- `create_conversation` — start a new conversation thread to hold memory across turns.
- `list_conversations` — list conversation threads for the organization, most recently active
  first.
- `get_conversation` — fetch a conversation and its full message history (oldest first).
- `add_message` — append a turn (`user`/`assistant`/`system`, content, optional citations) to a
  conversation.

Every tool takes an optional `organization_id`; when omitted it resolves to
`RETENTIONOS_ORG_ID`, then the first organization in the database. This keeps every call
tenant-scoped even when this server bypasses row-level security.

## Resources

- `conversation://{id}` — a conversation thread and its full message history, as JSON.

## Run it

```bash
# needs DATABASE_URL (and optionally RETENTIONOS_ORG_ID to pin a default org)
pnpm --filter @retentionos/mcp-backbone start
```

## Connect from Claude Desktop
Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "retentionos-backbone": {
      "command": "pnpm",
      "args": ["--filter", "@retentionos/mcp-backbone", "start"],
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
one backbone tool surface, driven from two vendors.
