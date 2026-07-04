# @retentionos/mcp-content

The content-engine Model Context Protocol server — draft, review, approve, and queue
retention campaigns as tools any agent (Claude, an OpenAI Agents-SDK caller, etc.) can call.

Backed by `@retentionos/content` (drafting/preview logic) and `@retentionos/db` (the same
shared data-access layer the web app and `mcp-crm` use), talking to the owned Postgres via
`DATABASE_URL`.

## Tools

- `list_templates` — list content templates, optionally filtered by `client_id`/`channel`.
- `list_campaigns` — list campaigns, optionally filtered by `client_id`/`status`.
- `get_campaign` — fetch a single campaign by id, including all of its variants.
- `draft_campaign` — resolve an audience against live retention analytics, generate grounded
  subject+body copy (or fall back to a deterministic template if no model API key is
  configured), and persist the audience/campaign/variant(s) as `draft`. Logs a
  `campaign.drafted` activity. Returns `used_fallback: true` when the template fallback ran.
- `preview_personalized` — read-only: re-resolve a campaign's audience and return the first
  N members with each variant personalized (`{{first_name}}`, `{{discount_code}}`) for them.
- `approve_campaign` — mark a campaign `approved`. Logs a `campaign.approved` activity.
  Required before `queue_send` will do anything.
- `queue_send` — **guarded**: fails with "Campaign must be approved before sending." unless
  the campaign is already `approved`. Otherwise re-resolves the audience, creates one
  `messages` row per member (rendered from variant A, personalized), marks the campaign
  `sent`, and logs a `campaign.queued` activity.
  **This does not call Resend/Twilio/any ESP.** It only queues `messages` rows — real
  delivery needs provider credentials this environment does not have. Both the tool
  description and its returned summary say so explicitly.

Every tool takes an optional `organization_id`; when omitted it resolves to
`RETENTIONOS_ORG_ID`, then the first organization in the database. This keeps every call
tenant-scoped even though this server bypasses row-level security.

## Resources

- `campaign://{id}` — a single campaign as JSON.

## Run it

```bash
# needs DATABASE_URL (and optionally RETENTIONOS_ORG_ID / ANTHROPIC_API_KEY / OPENAI_API_KEY)
pnpm --filter @retentionos/mcp-content start
```

Without an `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` in the environment, `draft_campaign` still
works — `@retentionos/content` catches the generation failure and falls back to a
deterministic, grounded template draft (`model_used: "template-fallback"`,
`used_fallback: true` in the tool result). Set `RETENTIONOS_CONTENT_FALLBACK=1` to force the
fallback path even when a key is present (useful for testing).

## Connect from Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "retentionos-content": {
      "command": "pnpm",
      "args": ["--filter", "@retentionos/mcp-content", "start"],
      "env": {
        "DATABASE_URL": "postgresql://ros:ros@127.0.0.1:5432/retentionos",
        "RETENTIONOS_ORG_ID": "…"
      }
    }
  }
}
```

## Connect from OpenAI

OpenAI's Agents SDK supports MCP servers directly (point it at this stdio command), or wrap
the tools as OpenAI function tools via a thin adapter. Either way it calls the **same**
tools — one content tool surface, driven from two vendors.
