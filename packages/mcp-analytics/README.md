# @retentionos/mcp-analytics

The Analytics Model Context Protocol server — the "chat with your retention data" tool
surface. Same tools, every agent — this is the "works with any model" layer in practice
(docs/04-ai-and-agent-layer.md).

Backed by `@retentionos/db`, the same shared data-access layer the web app uses, talking to the
owned Postgres via `DATABASE_URL`. Every tool here is **read-only**.

## Tools

- `client_retention_overview` — the "how healthy is this client's retention" summary: total
  customers, total revenue, average AOV, and counts by lifecycle stage.
- `list_segment` — list the customers currently in a lifecycle-stage segment
  (`new`/`active`/`at_risk`/`churned`/`won_back`/`vip`), richest first. Use `at_risk` or
  `churned` to find "who to win back"; use `vip` to find the VIPs.
- `customer_metrics` — the latest computed RFM (recency/frequency/monetary), lifecycle_stage,
  and churn_risk per customer, highest spend first.
- `cohort_retention` — monthly acquisition-cohort retention rows (customers/retained/revenue
  per cohort per period_index), ordered for charting.
- `product_performance` — top products by revenue, with units sold.

Every tool takes an optional `organization_id`; when omitted it resolves to
`RETENTIONOS_ORG_ID`, then the first organization in the database. This keeps every call
tenant-scoped even when this server bypasses row-level security.

## Resources

- `retention://{clientId}` — the retention overview for a single client, as JSON.

## Run it

```bash
# needs DATABASE_URL (and optionally RETENTIONOS_ORG_ID to pin a default org)
pnpm --filter @retentionos/mcp-analytics start
```

## Connect from Claude Desktop
Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "retentionos-analytics": {
      "command": "pnpm",
      "args": ["--filter", "@retentionos/mcp-analytics", "start"],
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
one analytics tool surface, driven from two vendors.
