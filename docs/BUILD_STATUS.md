> ⚠️ **SUPERSEDED (2026-07-04).** This doc describes the pre-pivot build. The authoritative plan is now [08-course-correction.md](08-course-correction.md). Kept as historical record.

# Build Status

Snapshot of what actually exists in the repo vs. what's gated on an external credential.
Everything below runs and was verified against a local Postgres + pgvector, with **no API keys
and no cloud services** (see [LOCAL_DEV.md](LOCAL_DEV.md)). Credential-gated pieces are built to the
boundary — the code path exists and typechecks; it activates when you add the key/service.

## The system, in one picture

```
apps/
  web/     Next.js app — CRM, Retention analytics, Projects/Tasks, Campaigns, Dashboard, Chat, Auth
  site/    Marketing website (standalone)
packages/
  db/           owned Postgres: 8 migrations + the shared tenant-scoped data-access layer + analytics
  ai/           provider-agnostic LLM layer (Anthropic/OpenAI, config-routed)
  content/      campaign drafting (grounded generation + keyless template fallback)
  integrations/ Shopify · Klaviyo · Airtable connectors (fixture-verified; live paths guarded)
  mcp-crm · mcp-analytics · mcp-pm · mcp-content · mcp-reporting · mcp-backbone   (6 MCP servers)
context/   Obsidian vault (brand voice, SOPs) — ingested into documents
```

One owned Postgres is the single source of truth. Every subsystem has **both** a UI surface and an
**MCP server**, so the same capability is usable by a person and drivable by any AI agent.

## By phase

| Phase | What runs now (verified, no keys) | Gated (activates with…) |
|-------|-----------------------------------|--------------------------|
| **0 · Foundations** | monorepo, 8 migrations, RLS, `packages/ai` (compiles vs Anthropic+OpenAI), `packages/db`, Next.js app. **Auth** wired + env-gated (local dev unchanged). | live login → a **Supabase project** (`AUTH.md`) |
| **1 · CRM** | clients/contacts/channels/documents/activities; list + detail UI; full `mcp-crm` (8 tools). Airtable import path built (Phase 3 connectors). | "chat with this client" RAG → an **embeddings key** |
| **2 · Agentic PM** | projects/tasks/deps/comments; Kanban board + overdue view; `mcp-pm` (11 tools). | in-app auto-propose / roll-up → an **LLM key** (an external agent can drive `mcp-pm` today) |
| **3 · Client Data & Analytics** | Shopify/Klaviyo/Airtable connectors (fixture-synced, idempotent); RFM/lifecycle/churn/cohort engine; retention UI; `mcp-analytics` (5 tools). | live sync → **per-client Shopify/Klaviyo creds** |
| **4 · Content Engine** | campaigns/variants/messages/templates/audiences; audiences = queries against analytics; draft→approve→queue UI; `mcp-content` (7 tools). Drafting uses a **template fallback** now. | real copy generation → an **LLM key**; real send → **Resend/Twilio/ESP creds** |
| **5 · Reporting** | real health scores; portfolio metrics + agency dashboard; `mcp-reporting` (6 tools); metric snapshots. | Metabase (deferred, a separate service) |
| **6 · Data Backbone** | conversations schema; **keyless unified cross-subsystem search**; Obsidian ingestion; chat UI (composes answers from search); `mcp-backbone` (5 tools). | semantic RAG + LLM answers → **embeddings + LLM keys** |
| **7 · Website** | standalone marketing site (`apps/site`), built + verified. | rename the placeholder brand; wire a scheduler for "Book a call" |

## How to turn the gated pieces on
1. **See it in your own browser** → create a Supabase project, set `DATABASE_URL` + the `NEXT_PUBLIC_SUPABASE_*` vars, `pnpm --filter @retentionos/db migrate`, deploy `apps/web` to Vercel. (Auth then enforces automatically.)
2. **Real AI generation / RAG / chat answers** → set `ANTHROPIC_API_KEY` (and/or `OPENAI_API_KEY`). The content engine, PM workflows, and chat switch from fallback to live generation with no code change (`packages/ai/src/models.ts` routes tasks→models).
3. **Real client data** → add each client's Shopify + Klaviyo credentials; `integrations` `syncLive` populates the same tables the analytics/UI/MCP already use.
4. **Delivery** → add Resend/Twilio (or push to the client's ESP); `mcp-content` `queue_send` already stages the messages.

## Verified end-to-end (local, no keys)
- All 8 migrations apply; 12 workspace projects typecheck together; `apps/web` + `apps/site` build.
- Seed: 3 clients, 94 customers, 421 orders, computed analytics, 18 tasks, campaigns, Obsidian docs.
- Every MCP server driven over the real MCP protocol; every mutating tool logs an
  `actor_type='agent'` activity (auditable).
- Content flow: draft (fallback) → approve-gate → queue personalized messages.
- Search: "coffee" → Northwind; "winback" → ingested SOP. Chat composes cited answers.
- Connectors: fixture sync idempotent; analytics recompute on synced data.
