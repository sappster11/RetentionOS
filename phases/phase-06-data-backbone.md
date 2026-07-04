# Phase 6 — Data Backbone / Chat-with-everything (final boss)

**Goal:** one surface that chats across **all** of it — CRM, PM, content, reporting, Slack history,
docs, calendars, and the Obsidian vault — and can **act** through every MCP server in a single
conversation. This is the payoff the whole plan builds toward.

**Why last:** it depends on the other subsystems existing (there's nothing to unify otherwise), and
it's the hardest to get right. By now most capability already exists as MCP servers + RAG — this
phase is mostly **unification and ingestion breadth**, not net-new features.

**Prerequisites:** Phases 1–5 (ideally all; at minimum 1–4, so there are subsystems worth unifying).

**Read first:** [docs/04-ai-and-agent-layer.md](../docs/04-ai-and-agent-layer.md),
[docs/01-architecture.md](../docs/01-architecture.md).

---

## Tasks

### 6.1 — Unified ingestion (breadth)
Bring the remaining sources into `documents`/`embeddings` (P2: DB canonical; P8: markdown for
context). Each is an **edge connector** that syncs inbound.
- [ ] **Slack**: sync linked channels' messages (from Phase 1 `channels`) into `documents`, chunked +
      embedded, scoped to the client.
- [ ] **Google Calendar**: ingest client calendar events as activities/documents.
- [ ] **Google Drive / Notion**: ingest linked docs' text.
- [ ] **Obsidian vault**: ingest the `context/` markdown folder (brand voice, SOPs, briefs, playbooks).
- [ ] One shared ingestion pipeline (chunk → embed → upsert) reused across all sources; incremental
      (only new/changed) and re-runnable.
- **Acceptance:** content from each source is retrievable via a tenant/client-scoped vector query and
      correctly attributed to its `source_type`/`source_id`.

### 6.2 — Cross-subsystem retrieval
- [ ] A retrieval layer that can pull from **any** source in one query, scoped by org and (optionally)
      client, with source-type filters and citations back to the origin row.
- **Acceptance:** one question can surface a Slack message, a task, a campaign, and a brief together,
      each cited.

### 6.3 — The unified chat surface
- [ ] A chat UI that holds **all** MCP servers at once (`mcp-crm`, `mcp-pm`, `mcp-analytics`,
      `mcp-content`, `mcp-reporting`) plus cross-subsystem RAG.
- [ ] The assistant can both **answer** (grounded, cited) and **act** (create tasks, draft campaigns,
      pull reports) in a single conversation, using `packages/ai` with provider chosen by config.
- [ ] Mutating actions still respect approval gates from their subsystem (e.g. no send without
      approval).
- **Acceptance:** from one chat box: "Summarize where Client X stands, draft their win-back email, and
      create a review task" → grounded summary + a saved draft + a created task, all cited/logged,
      with the model provider swappable in config.

### 6.4 — Conversation memory
- [ ] Migration: `conversations` + `conversation_messages` (org/user scoped, RLS) so the assistant has
      history and context across turns and sessions.
- [ ] Retrieval can include prior conversation context where relevant.
- **Acceptance:** a follow-up question ("now do the same for Client Y") works using prior context;
      history persists and is scoped correctly.

### 6.5 — Provider-agnostic proof, at full scope
- [ ] Confirm the entire chat surface runs on Claude *and* on OpenAI by config change only — same MCP
      tools, same RAG, same UI.
- **Acceptance:** flipping the `chat` route in `config/models.ts` swaps the driving model with no code
      change and the demo in 5.3 still passes.

---

## Phase 6 exit criteria (milestone demo)
From a single chat box:
1. Answer **any** question about **any** client using **any** source (CRM, PM, content, reporting,
   Slack, docs, Obsidian), grounded and cited.
2. Kick off **real actions** across subsystems in the same conversation (respecting approval gates).
3. Do all of the above with the model provider swappable by config — proving "works with Claude or
   OpenAI or any model" at full scope.

When all three work, the core vision is realized: an owned, AI-native retention agency where the
tools work together, the data is owned and chattable, and any agent can operate the whole thing.

## Notes / decisions log
> Record ingestion cadences, chunking choices, citation format, and memory-window decisions here.
