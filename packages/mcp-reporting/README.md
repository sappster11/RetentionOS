# @retentionos/mcp-reporting

The Reporting Model Context Protocol server — the "speak the numbers" tool surface: portfolio
health, at-risk clients, retention metrics. Same tools, every agent — this is the "works with
any model" layer in practice (docs/04-ai-and-agent-layer.md).

Backed by `@retentionos/db`, the same shared data-access layer the web app uses, talking to the
owned Postgres via `DATABASE_URL`. Mostly **read-only** — the one exception is
`refresh_health_scores`, which recomputes and persists `clients.health_score`.

## Tools

- `portfolio_overview` — the "how's the whole book of business" summary: client count, total
  customers, total revenue, average health score, at-risk client count, and campaign count.
- `client_health` — a client's current health score plus the drivers behind it (active/churn/
  at-risk lifecycle shares, overdue-task count) and its lifecycle-stage customer counts.
- `at_risk_clients` — which clients need attention right now and why (status is at_risk, or
  health score < 40), worst health first, each with a short human-readable reason.
- `retention_metrics` — per-client retention snapshot: customers, revenue, active/at-risk/
  churn percentages, and health score, ordered by client name.
- `refresh_health_scores` — recomputes and **persists** health_score for every non-archived
  client in the org and returns the updated scores + drivers. The one mutating tool here; logs
  a `reporting.recomputed` activity.
- `run_report` — convenience umbrella: `report: "portfolio" | "at_risk" | "retention"` dispatches
  to the matching read tool above, so an agent can ask for a named report by string.

Every tool takes an optional `organization_id`; when omitted it resolves to
`RETENTIONOS_ORG_ID`, then the first organization in the database. This keeps every call
tenant-scoped even when this server bypasses row-level security.

## Resources

- `report://portfolio` — the portfolio overview, as JSON.

## Run it

```bash
# needs DATABASE_URL (and optionally RETENTIONOS_ORG_ID to pin a default org)
pnpm --filter @retentionos/mcp-reporting start
```

```bash
DATABASE_URL=postgresql://ros:ros@127.0.0.1:5432/retentionos \
  pnpm --filter @retentionos/mcp-reporting start
```

## Connect from Claude Desktop
Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "retentionos-reporting": {
      "command": "pnpm",
      "args": ["--filter", "@retentionos/mcp-reporting", "start"],
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
one reporting tool surface, driven from two vendors.
