> ⚠️ **SUPERSEDED (2026-07-04).** This spec describes the pre-pivot build. The authoritative plan is now [docs/08-course-correction.md](../docs/08-course-correction.md). Kept as historical record.

# Phase 0 — Foundations

**Goal:** a running, deployed app on an owned database, with a *proven* provider-agnostic AI layer
and the first MCP tool working end-to-end. No product features yet — this is the launchpad.

**Prerequisites:** provider accounts from
[docs/02-tech-stack.md](../docs/02-tech-stack.md#provider-accounts-to-create-checklist) — at minimum
Supabase, Vercel, an Anthropic key, and an OpenAI key.

**Definition of Done:** see [docs/07-working-agreement.md](../docs/07-working-agreement.md). Every
task below has explicit acceptance criteria; don't tick a box until you've *run* the thing.

---

## Build status (as scaffolded)

Scaffolded and **verified locally** (no credentials required):
- ✅ Monorepo: pnpm workspace, strict TS base, `.env.example`, `.gitignore`. `pnpm install` clean.
- ✅ `packages/db`: migrations `0001_foundations` + `0002_pgvector_embeddings` written; forward-only
  `migrate` runner. *(Not yet applied to a real DB — needs `DATABASE_URL`.)*
- ✅ `packages/ai`: full provider-agnostic layer; `pnpm -r typecheck` passes against Anthropic +
  OpenAI SDKs.
- ✅ `packages/mcp-crm`: `list_clients` server; **verified end-to-end** over the MCP protocol
  (initialize / tools-list / tools-call).
- ✅ `apps/web`: Next.js app + Supabase client helpers; `next build` compiles and prerenders.

Remaining — **needs your credentials** (see the checklist in
[docs/02-tech-stack.md](../docs/02-tech-stack.md#provider-accounts-to-create-checklist)):
- ⏳ Create Supabase project → set env → **apply migrations** (`pnpm --filter @retentionos/db migrate`)
  and generate types (task 0.2).
- ⏳ Auth: login + `users` profile link + protected route + session middleware (task 0.3).
- ⏳ Prove the AI swap live: run `generate` against Anthropic, flip config to OpenAI (task 0.4).
- ⏳ Prove MCP from **both** vendors against real data (task 0.6).
- ⏳ CI (typecheck + lint + migrations-apply) and Vercel deploy (task 0.7).

---

## Tasks

### 0.1 — Repo & app skeleton
- [ ] Initialize `apps/web` as a Next.js (App Router, TypeScript strict) app with `pnpm`.
- [ ] Add lint + format + typecheck scripts.
- [ ] App runs locally and shows a placeholder authenticated home page.
- **Acceptance:** `pnpm dev` serves the app; `pnpm typecheck` and `pnpm lint` pass clean.

### 0.2 — Supabase project & `packages/db`
- [ ] Create the Supabase project; store connection details in env config (not committed).
- [ ] Set up migration tooling (Supabase CLI) under `packages/db`.
- [ ] First migration: `organizations`, `users` (mirror of `auth.users`), `memberships` with the
      `role` enum, plus `updated_at` triggers.
- [ ] Enable RLS on all three; policy: a user sees an org only if they have a membership in it.
- [ ] Generate TypeScript types from the schema into `packages/db`.
- **Acceptance:** migration applies cleanly to a fresh DB; a seeded test user can read only their own
      org via a policy test.

### 0.3 — Auth
- [ ] Wire Supabase Auth into `apps/web` (email/password or magic link — pick one, document it).
- [ ] On first login, create/link a `users` profile row.
- [ ] A protected route that requires login and shows the current user + their org.
- **Acceptance:** logging in shows your org; logging out blocks the protected route.

### 0.4 — `packages/ai`: provider-agnostic LLM layer
- [ ] Install the Vercel AI SDK + Anthropic and OpenAI providers.
- [ ] Implement `generate`, `stream`, `embed` per
      [docs/04-ai-and-agent-layer.md](../docs/04-ai-and-agent-layer.md).
- [ ] Add `config/models.ts` routing table (look up **current** model IDs from provider docs; don't
      hardcode from memory).
- [ ] Support a per-call `model` override and a fallback on the routed model.
- **Acceptance:** a script calls `generate({task:'chat', ...})`; flipping the `chat` route from the
      Anthropic model to the OpenAI model in config changes the provider with **no code change** and
      both return a valid completion. `embed` returns a vector of the configured dimension.

### 0.5 — pgvector enabled
- [ ] Migration enabling the `vector` extension and creating the `embeddings` table
      ([docs/03-data-model.md](../docs/03-data-model.md)) with an index and RLS.
- **Acceptance:** you can insert an embedding and run a nearest-neighbour query scoped by org.

### 0.6 — First MCP server (`packages/mcp-crm` skeleton)
- [ ] Stand up a minimal MCP server exposing one read tool, `list_clients` (returns empty list until
      Phase 1 — that's fine), tenant-scoped.
- [ ] Document how to connect it from Claude Desktop **and** how to call it from an OpenAI
      Agents-SDK script (or via the function-tool adapter).
- **Acceptance:** the same `list_clients` tool responds correctly when driven from Claude *and* from
      an OpenAI-based caller. This proves the "any agent" path before we build real tools.

### 0.7 — CI & deploy
- [ ] CI on every push: typecheck + lint + "migrations apply to a fresh DB".
- [ ] Deploy `apps/web` to Vercel; connect Supabase env vars.
- [ ] `.env.example` documents every required variable with placeholders.
- **Acceptance:** a push runs CI green; the deployed URL loads and login works against the real
      Supabase project.

---

## Phase 0 exit criteria (the milestone demo)
You can:
1. Log into the deployed app as a team member scoped to an organization.
2. Call the `list_clients` MCP tool from **both** Claude and an OpenAI-based agent and get a
   tenant-scoped response.
3. Change one line in `config/models.ts` to swap the generation provider, and a `generate` call
   still works.

When all three are true, Phase 0 is done → proceed to
[phase-01-crm-foundation.md](phase-01-crm-foundation.md).

## Notes / decisions log
> Record any non-specified choices you made here (auth method, exact model IDs chosen, etc.) so the
> next person/agent has context.
