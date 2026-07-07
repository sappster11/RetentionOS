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

## The monthly review loop (agent-assisted)
On each cycle: review Brand Goals status → review Marketing Calendar → review the new
Prompt Doc Responses → draft the Monthly Strategy (linked to goals + research) → derive
the content strategy → produce creative into Copy Drafts. The agent's system prompt
encodes this recipe; automations (docs/11 schedule trigger) will eventually initiate it.

## UI reshell (parallel directive)
Left-side nav dashboard: workspaces (bases) as nav sections, tables as items beneath
them, slim top bar, content area = the existing grid/kanban/detail machinery (which is
the point: rows, columns, filters, views, sorting all stay). Retention + future
sections (Studio dashboards) become nav destinations. Light, modern, unbranded.

## Open items (defaults chosen, revisit any time)
- Prompt-doc question SETS (the template each cycle instantiates): v1 keeps a canonical
  set per client in the table itself (Cycle = "Template"); a proper template mechanism
  can follow.
- Warehouse connector shape (direct SQL read-only vs n8n-mediated): deferred to when
  the warehouse is picked/live.
