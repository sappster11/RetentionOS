# RetentionOS

The operating platform for **Roam** — an Airtable-class flexible data platform that humans
and AI agents operate as equals. You (or an agent, mid-conversation) create tables, fields,
linked records, rollups, and views at runtime; Roam's client-hub CRM and sales pipeline are
the first things *configured inside* the engine, not hardcoded into it.

> **Course correction (2026-07-04):** this repo originally contained a fixed-schema
> retention app built from a written plan. That build missed the target and has been
> superseded. The authoritative plan is now
> **[docs/08-course-correction.md](docs/08-course-correction.md)** — read that first.
> Old docs and phase specs are banner-marked and kept as historical record.

## The one-paragraph thesis

We own the **core** (our data + the engine) and rent the **edges** (Slack, Tally, n8n,
email/SMS providers). One service layer sits under everything; the web UI, a generic
**MCP server**, and n8n webhooks are all clients of the same API — so anything a human can
do by clicking, an agent can do by tool call (**agent-parity law**). The endgame is an
agency that runs itself through this platform, with a chat surface embedded in the walls.

## How to read this repo

| Doc | What it answers |
|-----|-----------------|
| [docs/08-course-correction.md](docs/08-course-correction.md) | **The plan. Start here.** Decisions, V1 scope, phases A–D |
| [docs/07-working-agreement.md](docs/07-working-agreement.md) | Rules for the AI/dev executing the plan (still in force) |
| [docs/02-tech-stack.md](docs/02-tech-stack.md) | Tooling (still mostly accurate; 08 wins on conflict) |
| [docs/LOCAL_DEV.md](docs/LOCAL_DEV.md) | How to run locally |
| docs 00–06, `phases/`, [docs/BUILD_STATUS.md](docs/BUILD_STATUS.md) | Superseded pre-pivot plan (historical) |

## Build order at a glance

```
Phase A  Engine core       meta-schema, service layer, REST API, app shell, grid view
Phase B  Relations & views linked records, lookups, rollups, Kanban, record detail
Phase C  Agent surface     generic MCP server, chat sidebar (UI only), audit/history
Phase D  Roam CRM          client hub + sales pipeline as engine configurations, n8n webhooks
Later    forms, wired in-app agent, automations, analytics backbone, multi-user
```

## Status

- [x] Course-correction plan written (docs/08)
- [x] Phase A — Engine core *(+ Airtable-parity grid polish)*
- [ ] Phase B — Relations & views
- [ ] Phase C — Agent surface
- [ ] Phase D — Roam CRM as configuration

**Parked from the pre-pivot build** (kept in-tree, out of scope): migrations 0003–0008 and
their tables, `packages/integrations` (Shopify/Klaviyo/Airtable connectors), the six
domain `packages/mcp-*` servers, and the old app routes. Migrations 0001 (orgs/auth/RLS)
and 0002 (pgvector) remain foundations. `apps/site` is untouched by the pivot.
