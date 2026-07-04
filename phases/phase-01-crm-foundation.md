# Phase 1 — Client CRM (the wedge)

**Goal:** replace Airtable as the home of client data. Clients, contacts, and the external
"containers" (Slack channels, drives, calendars, docs) live in **our** database with a real UI, a
full MCP server, and a first "chat with this client" experience.

**Why first:** everything else — project management, content, reporting, the unified backbone —
plugs into the client record. Nail this and the rest composes.

**Prerequisites:** Phase 0 complete (deployed app, auth, `packages/ai`, `embeddings`, `mcp-crm`
skeleton).

**Read first:** [docs/03-data-model.md](../docs/03-data-model.md) and
[docs/04-ai-and-agent-layer.md](../docs/04-ai-and-agent-layer.md).

---

## Build status

Built and **verified against a live local Postgres** (no API keys — see
[docs/LOCAL_DEV.md](../docs/LOCAL_DEV.md)):
- ✅ **1.1 CRM schema** — `migrations/0003_crm.sql`: all six tables + enums + `updated_at` triggers
  + RLS. Applies cleanly.
- ✅ **1.2 Client CRUD (server + UI)** — `/clients` list (status filter, table, new-client form) and
  `/clients/[id]` detail; tenant-safe server actions; every change logs an activity.
- ✅ **1.3 Channels** — link/list external containers on the client page.
- ✅ **1.5 `mcp-crm` full server** — 8 tenant-safe tools on the shared `@retentionos/db` layer;
  every mutation logs an `actor_type='agent'` activity. Verified over the MCP protocol.
- 🟡 **1.4 Documents** — upload/note UI + storage done; **embedding ingestion deferred** (needs the
  AI layer / an embeddings provider).

Deferred — **needs AI provider keys** (do when keys are available):
- ⏳ **1.4 ingestion → embeddings**, **1.6 chat-with-your-client (RAG)**, and semantic `search_clients`
  (currently name/industry ILIKE; upgrade to vector search later).
- ⏳ **1.7 Airtable importer** — one-time migration from the current Airtable base (no keys needed;
  just not built yet — a good next no-key task).

Note: local dev connects as a superuser, so RLS is defined but not exercised until Supabase Auth
(Phase 0.3) is wired. Data access goes through `@retentionos/db` over `DATABASE_URL` — identical
against local Postgres and Supabase.

---

## Tasks

### 1.1 — CRM schema
- [ ] Migration creating `clients`, `contacts`, `channels`, `documents`, `activities`,
      `integrations` exactly per the data-model doc, each with `organization_id`, `updated_at`
      triggers, and **RLS in the same migration**.
- [ ] Enums: client `status`, `lifecycle_stage`, `tier`; channel `kind`.
- [ ] Regenerate `packages/db` types.
- **Acceptance:** migrations apply to a fresh DB; RLS test proves a user in org A cannot read org B's
      clients.

### 1.2 — Client CRUD (server + UI)
- [ ] Server actions / API for create, read, update, archive of clients and contacts.
- [ ] **Client list view:** an Airtable-like table with sort/filter by status, tier, owner; plus a
      simple board view grouped by `status` or `lifecycle_stage`.
- [ ] **Client detail page:** header (status, tier, owner, health placeholder), tabs/sections for
      Contacts, Channels, Documents, and an Activity timeline.
- [ ] Creating/editing writes an `activities` row.
- **Acceptance:** you can fully manage a client and its contacts from the UI; changes appear in the
      timeline; everything is org-scoped.

### 1.3 — Channels (the Airtable "containers")
- [ ] UI to link external containers to a client: pick a `kind` (slack/gdrive/gcal/notion/…), name,
      URL, external id.
- [ ] Store in `channels`; show them on the client page as clickable links.
- **Acceptance:** a client shows its linked Slack channel, drive folder, and calendar as links; data
      round-trips through `channels`.

> Live *sync* of these (pulling Slack messages, calendar events) is Phase 5. Phase 1 just records
> **where** a client's stuff lives.

### 1.4 — Documents + ingestion
- [ ] Upload/attach documents to a client (Supabase Storage) and/or paste notes; store text in
      `documents.content`.
- [ ] Ingestion function: chunk + embed new/changed `documents` and activity summaries into
      `embeddings` (uses `packages/ai` `embed`), org- and client-scoped.
- **Acceptance:** adding a document makes its content searchable via a vector query scoped to that
      client.

### 1.5 — `mcp-crm` full server
Flesh out the Phase 0 skeleton into the real CRM tool surface
([docs/04-ai-and-agent-layer.md](../docs/04-ai-and-agent-layer.md#part-2--mcp-the-any-agent-can-operate-the-agency-layer)):
- [ ] Read tools: `list_clients`, `get_client`, `search_clients` (structured + semantic),
      `list_contacts`.
- [ ] Write tools: `create_client`, `update_client`, `add_note`, `link_channel`.
- [ ] Resources: `client://{id}`, `contact://{id}`.
- [ ] Every tool tenant-safe; every mutation writes an `activities` row (`actor_type='agent'`).
- **Acceptance:** from Claude *and* an OpenAI-based agent, you can list/search clients, read a client
      resource, and add a note — and the note shows up in the UI timeline attributed to the agent.

### 1.6 — Chat-with-your-client (RAG v1)
- [ ] A chat box on the client detail page.
- [ ] Pipeline per [docs/04 §RAG](../docs/04-ai-and-agent-layer.md#rag-retrieval-augmented-generation):
      embed question → vector search `embeddings` scoped to org+client → `generate({task:'chat'})`
      with retrieved context → answer with citations to source rows.
- [ ] If retrieval finds nothing relevant, the assistant says so — it never invents client facts.
- **Acceptance:** on a client with real docs/activity, "summarize where we are and what's overdue"
      returns a grounded answer citing sources; on an empty client it declines rather than fabricates.

### 1.7 — Airtable migration (one-time importer)
- [ ] A script that reads your current Airtable base and maps records into `clients`, `contacts`,
      `channels`, `documents`.
- [ ] Idempotent (re-runnable without duplicating) via a stable external key stored in `metadata`.
- [ ] A short mapping doc: which Airtable field → which column.
- **Acceptance:** running the importer populates RetentionOS with your real clients; re-running does
      not duplicate. Airtable is now a *source*, and our Postgres is the source of truth.

---

## Phase 1 exit criteria (the milestone demo)
Open a real client in RetentionOS and:
1. See everything Airtable held — contacts, linked channels, documents, activity.
2. Ask "summarize where we are with this client and what's overdue" and get a grounded, cited answer.
3. Have an agent (Claude or OpenAI) add a note via `mcp-crm` and watch it appear in the timeline.

When all three work, Phase 1 is done → proceed to Phase 2 (write
`phases/phase-02-agentic-pm.md` from the roadmap first).

## Notes / decisions log
> Record field mappings, any schema deviations, and non-specified choices here.
