> ⚠️ **SUPERSEDED (2026-07-04).** This doc describes the pre-pivot build. The authoritative plan is now [08-course-correction.md](08-course-correction.md). Kept as historical record.

# 05 · Roadmap

Build order reflects your call: **the client CRM is the wedge everything plugs into**, and the
unified "chat with everything" data backbone is the **final** boss because it's the hardest and it
depends on all the other subsystems existing first.

Each phase is: a clear goal, what gets built, and a **milestone demo** — the single thing that, when
you can do it live, means the phase is done. Detailed task-level specs live in `/phases`.

---

## Phase 0 — Foundations
**Goal:** a running app, an owned database, and a *proven* provider-agnostic AI layer.

- Next.js app + Supabase project wired together, deployed to a URL.
- Auth (team login), `organizations`/`users`/`memberships` tables, RLS baseline.
- `packages/ai`: `generate` + `embed` with model-routing config, working against **both** Anthropic
  and OpenAI (flip a config value, same code path).
- `packages/db`: migration tooling + generated TypeScript types.
- Minimal `mcp-crm` server exposing one read tool (`list_clients`) to prove the MCP path end-to-end.
- CI: typecheck + lint + migration check on every push.

**Milestone demo:** log in, and from Claude Desktop *and* from a script using OpenAI, call the same
`list_clients` MCP tool and get data back. Swap the generation model in config; a "hello" generation
still works.

---

## Phase 1 — Client CRM  ← the wedge
**Goal:** replace Airtable as the home of client data. Clients, contacts, and the external
"containers" (Slack channels, drives, calendars) live in *our* database, with a real UI and a full
MCP server. First taste of chat-with-your-data.

- Tables: `clients`, `contacts`, `channels`, `documents`, `activities`, `integrations` (from
  [03-data-model.md](03-data-model.md)) with RLS.
- CRUD UI: client list (Airtable-like table/board views), client detail page (contacts, linked
  channels, activity timeline, docs).
- `mcp-crm`: full CRUD + `search_clients` + `add_note` + `link_channel`, all tenant-safe and
  audit-logged.
- RAG v1: ingest `documents` + activity summaries → `embeddings`; a "chat with this client" box on
  the client page.
- **Airtable migration:** a one-time importer that reads your current Airtable base into these
  tables (Airtable becomes a *source*, not the source of truth).

**Milestone demo:** open a client in RetentionOS, see everything Airtable held, ask "summarize where
we are with this client and what's overdue," and get a grounded answer — and have an agent create a
note via MCP.

Full spec: [phases/phase-01-crm-foundation.md](../phases/phase-01-crm-foundation.md).

---

## Phase 2 — Agentic Project Management
**Goal:** projects and tasks that an agent can drive, built on the CRM.

- Tables: `projects`, `tasks`, `task_dependencies`, `task_comments`.
- UI: per-client project boards, task lists, assignments, due dates, statuses.
- `mcp-pm`: create/update/assign/close tasks, list overdue, roll up status.
- Agent workflows: "from this client's latest activity, propose and create this week's tasks";
  "summarize project status for the weekly update." Human approves; agent executes via MCP.

**Milestone demo:** an agent reads a client's recent activity and proposes a task list; you approve;
tasks appear on the board with owners and dates — and a status roll-up writes itself.

---

## Phase 3 — Client Data & Retention Analytics (Shopify + Klaviyo)
**Goal:** ingest each client's Shopify + Klaviyo data into our owned Postgres and derive a retention
analytics model (RFM, lifecycle, churn risk, cohorts). This is the **analytical engine** of the
agency — it's what makes campaigns *data-backed* rather than guesswork, and it feeds Content (4) and
Reporting (5).

- Tables: `client_customers`, `client_orders`, `client_order_items`, `client_products`,
  `client_engagement_events`, `client_segments`, `client_segment_members`, plus derived
  `client_customer_metrics` (RFM/lifecycle/churn) and `client_cohorts`.
- Connectors (`packages/integrations`): **Shopify** + **Klaviyo**, per-client auth, inbound-only,
  incremental & idempotent sync (P2 — our DB is canonical, we never write back).
- Analytics jobs: RFM scoring, lifecycle staging, churn-risk heuristic, cohort retention.
- UI: a "Retention" section on the client page; `mcp-analytics` so agents can *reason over* the data.

**Milestone demo:** a client's Shopify/Klaviyo data is synced and current; their page shows a real
retention snapshot; an agent can answer "who should we win back this month and what should we say"
grounded in that data.

Full spec: [phases/phase-03-client-data-analytics.md](../phases/phase-03-client-data-analytics.md).

---

## Phase 4 — Content Engine (email + SMS at volume)
**Goal:** produce large volumes of data-backed emails and SMS, grounded in the Phase 3 analytics +
brand voice. Audiences are *queries* against RFM/lifecycle/segments, not guesses.

- Tables: `campaigns`, `campaign_variants`, `messages`, `templates`, `audiences` (audiences reference
  Phase 3 `client_segments` / `client_customer_metrics`).
- Delivery: **Resend** for the agency's own email; for client campaigns, push the generated copy into
  **the client's own ESP** (Klaviyo, Customer.io, etc.) via a per-client edge connector. **Twilio**
  for SMS. RetentionOS owns the *content and the data*, not the client's delivery platform.
- `mcp-content`: `draft_campaign`, `draft_sms`, `personalize`, `queue_send`, `list_templates`;
  resolves audiences by calling `mcp-analytics`.
- Brand voice: each client's voice/guardrails stored as markdown context, injected via RAG.
- Human-in-the-loop review + approval before anything sends.

**Milestone demo:** for a chosen client + a data-derived audience (e.g. at-risk high-value buyers),
generate a personalized win-back email + SMS set grounded in their purchase data, review, approve,
and send through the real providers — logged to `messages`/`activities`.

---

## Phase 5 — Reporting Dashboards
**Goal:** great reporting over our **own** data, both for us and (later) for clients.

- Tables/views: `metrics`, `metric_snapshots`, SQL views. Health-score computation moves from
  placeholder to real, reading the Phase 3 analytics + these.
- **Fast path:** Metabase pointed at Postgres → dashboards on day one.
- **In-app path:** embedded client-facing dashboards (Recharts/Tremor).
- `mcp-reporting`: `client_health`, `retention_metrics`, `run_report` so agents can *speak* the
  numbers, not just render them.

**Milestone demo:** a live retention dashboard per client, plus asking an agent "which clients are
most at risk this month and why" and getting an answer backed by the same metrics.

---

## Phase 6 — Data Backbone / Chat-with-everything  ← final boss
**Goal:** one surface that chats across *all* of it — CRM, PM, analytics, content, reporting, Slack
history, docs, and the Obsidian vault — and can *act* through every MCP server.

- Unified ingestion: Slack messages, calendar events, Google Drive/Notion docs, and the Obsidian
  markdown vault all flow into `documents`/`embeddings` (P2/P8 intact — DB canonical, markdown for
  context).
- Cross-subsystem retrieval: one query can pull from any source, scoped by tenant/client.
- The chat surface holds **all** MCP servers, so "draft the win-back email and create the review
  task and tell me who's at risk" is one conversation.
- `conversations` history so the assistant has memory.

**Milestone demo:** from one chat box, answer any question about any client using any source, and
kick off real actions across every subsystem — model provider swappable in config throughout.

---

## Phase 7 — Website
**Goal:** the public face of the agency. Deliberately last; the machine matters more than the
brochure, and by now we have real capabilities to show. See [06-website.md](06-website.md) and
[phases/phase-07-website.md](../phases/phase-07-website.md).

---

## Sequencing notes
- **Phases 0→1 are non-negotiable prerequisites** for everything else.
- **Phase 3 (client data) must precede Phase 4 (content) and Phase 5 (reporting)** — they consume its
  analytics. Phase 2 (PM) is flexible and can move earlier/later.
- Every phase adds its **MCP server** as it goes, so the "chat with everything" backbone in Phase 6
  is mostly *unification*, not net-new capability.
- Don't start Phase 6 until at least Phases 1–4 exist; there's nothing to unify otherwise.
