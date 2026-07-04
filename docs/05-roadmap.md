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

## Phase 3 — Content Engine (email + SMS at volume)
**Goal:** produce large volumes of data-backed emails and SMS, grounded in client data + brand
voice, delivered through rented providers.

- Tables: `campaigns`, `campaign_variants`, `messages`, `templates`, `audiences`.
- Integrations: **Resend** (transactional), a marketing **ESP** (Customer.io/Klaviyo) for campaign
  send + deliverability + unsubscribe, **Twilio** for SMS.
- `mcp-content`: `draft_campaign`, `draft_sms`, `personalize`, `queue_send`, `list_templates`.
- Brand voice: each client's voice/guardrails stored as markdown context, injected via RAG so
  generated copy sounds like *them*.
- Human-in-the-loop review + approval before anything sends.

**Milestone demo:** for a chosen client and audience, generate a personalized win-back email + SMS
variant set grounded in their data, review, approve, and send through the real providers — with
sends logged back to `messages`/`activities`.

---

## Phase 4 — Reporting Dashboards
**Goal:** great reporting over our **own** data, both for us and (later) for clients.

- Tables/views: `metrics`, `metric_snapshots`, SQL views for common cuts. Health-score computation
  moves from placeholder to real, reading these.
- **Fast path:** Metabase pointed at Postgres → dashboards on day one.
- **In-app path:** embedded client-facing dashboards (Recharts/Tremor) for the metrics that belong
  inside RetentionOS.
- `mcp-reporting`: `client_health`, `retention_metrics`, `run_report` so agents can *speak* the
  numbers, not just render them.

**Milestone demo:** a live retention dashboard per client, plus asking an agent "which clients are
most at risk this month and why" and getting an answer backed by the same metrics.

---

## Phase 5 — Data Backbone / Chat-with-everything  ← final boss
**Goal:** one surface that chats across *all* of it — CRM, PM, content, reporting, Slack history,
docs, and the Obsidian vault — and can *act* through every MCP server.

- Unified ingestion: Slack messages, calendar events, Google Drive/Notion docs, and the Obsidian
  markdown vault all flow into `documents`/`embeddings` (P2/P8 intact — DB canonical, markdown for
  context).
- Cross-subsystem retrieval: one query can pull from any source, scoped by tenant/client.
- The chat surface holds **all** MCP servers, so "draft the win-back email and create the review
  task and tell me who's at risk" is one conversation.
- `conversations` history so the assistant has memory.

**Milestone demo:** from one chat box, answer any question about any client using any source, and
kick off real actions across CRM/PM/content — model provider swappable in config throughout.

---

## Phase 6 — Website
**Goal:** the public face of the agency. Deliberately last; the machine matters more than the
brochure, and by now we have real capabilities to show. See [06-website.md](06-website.md).

---

## Sequencing notes
- **Phases 0→1 are non-negotiable prerequisites** for everything else.
- Phases 2, 3, 4 can flex in order based on what wins clients fastest — but each still assumes the
  CRM (Phase 1) exists.
- Every phase adds its **MCP server** as it goes, so the "chat with everything" backbone in Phase 5
  is mostly *unification*, not net-new capability.
- Don't start Phase 5 until at least Phases 1–3 exist; there's nothing to unify otherwise.
