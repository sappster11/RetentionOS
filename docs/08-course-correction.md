# 08 — Course Correction (2026-07-04)

**Status: AUTHORITATIVE.** This doc supersedes the original plan (docs 00–06 and all
`phase-*` specs). Those files are kept as historical record and are banner-marked as
superseded. When this doc and an older doc disagree, this doc wins.

## What happened

The original plan was executed end-to-end and Jacob's verdict on the running app was
*"an ok start but quite a bit off."* A structured discovery session (2026-07-04) located
the divergence. It is not cosmetic — it is the foundation.

**Built:** a fixed-schema vertical retention app. Every table (`clients`, `client_orders`,
`campaigns`, …) hardcoded in SQL migrations, dashboard pages on top, dark AI-styled UI,
chat surface that is templated search-composition unless an LLM key is present.

**Wanted:** an **Airtable-class flexible data platform** ("the engine"): tables, fields,
linked records, rollups, and views are created *at runtime* by the user **or by an agent** —
never by a code deployment. Roam's CRM is the first thing *configured inside* the engine,
not the software itself.

## Context that changed the plan

- This is **greenfield for Roam**, Jacob's future agency. It replaces nothing on day one
  and migrates nothing. No deadline pressure; built deliberately while he's still employed.
- Jacob's current-job Airtable ("Clients" base, 14 tables + "SalesCRM" base, 4 tables) is
  the **reference model** — inspected directly via the Airtable MCP during discovery. We
  build the *improved* version, not a photocopy.
- Automations live in **n8n** (his choice over Zapier). Intake forms stay in Tally.
  RetentionOS integrates via REST + webhooks; it does not replace those tools.

## Decisions (locked)

1. **Meta-schema engine.** Users and agents create tables/fields/records/links/views at
   runtime. This is the product. Purpose-built schemas are data, not code.
2. **Agent-parity law.** Everything a human can do by clicking must be doable by an agent
   through a tool call. One service layer under everything; the web UI, the MCP server,
   and n8n webhooks are all clients of the same API. No UI-only actions, ever.
3. **Build order: client-hub CRM first, sales pipeline second** — both as configurations
   of the engine, both derived from the reference bases (cleaned up: no duplicate link
   fields, no per-year URL columns, no hand-maintained stage-timestamp columns).
4. **Retention/commerce machinery shelved.** Shopify/Klaviyo sync, RFM/churn scoring,
   cohorts, campaigns/content engine, and the analytics pages move out of scope. Code and
   migrations 0004–0007 are **parked, not deleted**. They return later as a separate
   "analytics backbone" reached from a client record.
5. **Chat sidebar ships in V1 as UI only** — built into the shell, **not wired to any LLM
   API yet**. External agents get full capability from day one via MCP instead.
6. **One generic MCP server** replaces the six domain servers: `create_table`, `add_field`,
   `list_tables`, `describe_table`, `query_records`, `create_record`, `update_record`,
   `delete_records`, view/link/rollup management. The six existing servers are parked.
7. **UI: light mode default**, Airtable-esque (dense grid, inline edit), with a real app
   shell (persistent left nav; the old build had none). Visual design otherwise not locked in.
8. **Solo user at V1.** Keep Supabase auth + `organizations`/`memberships` scaffolding
   (migration 0001) so real teammates can be added later. Client-facing access is
   explicitly cut — approvals go to the client's Slack, which stays the pattern.
9. **Free improvements over Airtable** (why we're building at all): automatic stage-change
   history on select fields, full record audit trail with human-vs-agent attribution.

## V1 engine scope (derived from the reference bases)

**Field types, Phase A:** text, long text, single select, multi select, number, currency,
checkbox, date, datetime, URL, email.
**Field types, Phase B:** attachment, linked record, lookup, rollup, autonumber,
created/last-modified time. **Fast-follow:** formula.
**Views:** grid + Kanban in V1. Gallery and native forms: fast-follow.

## Phases (new)

| Phase | Contents | Done when |
|-------|----------|-----------|
| **A — Engine core** | Meta-schema migration (`tables`/`fields`/`records`/`views` + revisions), `@retentionos/engine` service layer, REST API (`/api/v1`), app shell (light, left nav), grid view with inline edit, create table/field UI | You can create a table, add fields of every Phase-A type, and edit records in a grid — via UI *and* via curl |
| **B — Relations & views** | Linked records, lookups, rollups, Kanban view, record detail page | Client-hub-shaped data works: click into a record, see linked satellites and rolled-up values |
| **C — Agent surface** | Generic MCP server over the same service layer, chat sidebar (UI shell only, unwired), record history/audit UI | Claude (via MCP) can build and operate a schema end-to-end; every change shows attribution |
| **D — Roam CRM as configuration** | Client hub + sales pipeline schemas seeded as engine data (improved from reference bases), webhook endpoints for n8n | Roam's CRM exists inside the product; n8n can write a record |
| **Later** | Native forms, wired in-app agent, native automations, analytics-backbone reconnection, multi-user, client portal (last, if ever) | — |

## What survives from the existing build

- Monorepo layout, pnpm workspaces, TypeScript conventions.
- Migrations **0001** (orgs/users/memberships + RLS helpers) and **0002** (pgvector) —
  foundations the engine builds on. RLS conventions from `07-working-agreement.md` still apply.
- Supabase auth wiring (env-gated), `apps/site` (untouched by the pivot).
- **Parked:** migrations 0003–0008 and their tables, `packages/integrations`, the six
  `packages/mcp-*` servers, all app routes except the shell being rebuilt.

## Doc map after this correction

- `07-working-agreement.md` — still in force (build rules, RLS, verification).
- `02-tech-stack.md` — still mostly accurate; where it conflicts with this doc, this doc wins.
- `LOCAL_DEV.md` — still accurate.
- Everything else 00–06 + `phase-*` + `BUILD_STATUS.md` — superseded, banner-marked.
