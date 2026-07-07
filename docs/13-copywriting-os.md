# 13 — The Copywriting OS (specification)

**Status: authoritative (2026-07-06), from Jacob's direction.** Extends the Content
Studio (docs/12) into the full ingestion → strategy → creative pipeline. Two parallel
directives: (1) this system, (2) a UI reshell — clean modern dashboard, **left-side
nav**, no Airtable branding; rows/columns/filters/views/sorting are what matter.

## Design principle
Every input and output lives as **engine records** — which makes all of it agent-readable
by construction (describe_table + query_records via chat sidebar or MCP), versioned
(revisions = "when was this last updated" for free), and form-fillable (native forms).

## Ingestion (inputs), by cadence

| Table | Cadence | Contents |
|---|---|---|
| **Brand Resources** | one-time / infrequent | per-client uploads: brand guide, logo pack, product catalog, photography, reviews exports — Type + URL + notes. Freshness = engine `last_modified_time` + revision history (built-in; no manual "last updated" fields, ever) |
| **Research** (extended) | quarterly-ish | gains **Scope** (Brand / Competitor / Cultural) + **Quarter**; existing Type/Summary/Raw notes/Source stay |
| **Prompt Doc Responses** | monthly | replaces the Google Doc: one row per question per client per cycle (Client, Cycle month, Section, Question, Answer, Status). Fillable three ways: native form link sent to the client, the dashboard, or the agent transcribing a call. n8n's send/track flow (docs/11) writes Prompt Doc Cycles as today |
| **Brand Goals** | set at kickoff, reviewed monthly | Client, Goal, Horizon (Long / Short term), Metric, Target, Due, Status |
| **Agency Context** | rare | org-level (no client link): positioning, writing principles, do/don'ts. Rows marked **Always apply** are injected into every copy task by the agent |
| Performance data | stays in the **data warehouse** | NOT mirrored here. v1: the agent ingests pasted exports / summaries into Research (Type: Data Pull). v2: a read-only warehouse connector exposed as an agent tool (same pattern as the engine MCP tools). Shopify: the parked integrations sync + 0013 bridge (Retention section) already cover commerce-side ingestion |

## Outputs

| Table | Contents |
|---|---|
| **Monthly Strategies** | the monthly write-up: Client, Month, Strategy (long_text), links → Brand Goals it serves, Research it draws on, Status (Draft / In Review / Approved). Agent-draftable, human-approved |
| **Marketing Calendar** | Client, Date, Moment/Campaign, Channel, Status, Notes — reviewed in the monthly cycle |
| **Copy Drafts** (existing) | the actual creative, linked to Brand Voice / Research / Skills, Draft → In Review → Approved → Sent |

## The monthly concepting pipeline (corrected by the 2026-07-06 grill)
**Goals → Moments → Send Briefs → strategy recap → creative.** The strategy write-up is
a client-facing "here's why" RECAP produced after concepting (read, not approved;
current quality self-assessed "solid B" — the A cites goals and data). The unit of
concepting is the **Send Brief** (one per email/SMS): overview, goal, "What informed
this" (data-backed rationale), and the segment plan — which **the strategist approves,
always** (checkbox gate). Volume (e.g. 29 emails + 15 SMS) is a rollup of briefs, and
today's volume-setting is admittedly vibes — the agent pressure-tests it against goals.
Data sources named: Klaviyo pulls, Shopify reports, **Hiro** (external analytics —
and Jacob's stated ambition: **"I want to build our own Hiro"** — the reconnected
analytics backbone/Retention section is the seed of that product).
Deferred, designed: per-client **Segment Library** (exact Klaviyo names, agency-prefix
conventions, live/needs-creation status) so agents propose real segments; Hiro/warehouse
read-only connector.

## UI reshell (parallel directive)
Left-side nav dashboard: workspaces (bases) as nav sections, tables as items beneath
them, slim top bar, content area = the existing grid/kanban/detail machinery (which is
the point: rows, columns, filters, views, sorting all stay). Retention + future
sections (Studio dashboards) become nav destinations. Light, modern, unbranded.
**Superseded 2026-07-07: the app now wears the roam brand** — paper-world tokens
(theme.css), Newsreader/Libre Franklin/IBM Plex Mono via next/font, the italic
wordmark, moss/ember color roles, dark plates on login + client portal. Hexes marked
`~` in theme.css are approximations pending reconciliation against the canonical
roam-site/app/globals.css.

## Open items (defaults chosen, revisit any time)
- Prompt-doc question SETS (the template each cycle instantiates): v1 keeps a canonical
  set per client in the table itself (Cycle = "Template"); a proper template mechanism
  can follow.
- Warehouse connector shape (direct SQL read-only vs n8n-mediated): deferred to when
  the warehouse is picked/live.
