# 07 · Working Agreement (read before writing any code)

This document is aimed at **the AI model or developer executing this plan.** Follow it. It's what
keeps a phased, agent-built project from turning into a mess.

## How to work through this repo

1. **Read the docs in order** (00→07) before starting a phase. Then open the phase spec in `/phases`.
2. **Work one task at a time.** Each phase spec is a checklist of small tasks with acceptance
   criteria. Do the smallest next task, verify it, commit, move on.
3. **Never expand scope.** If a task tempts you to build something not in the plan, stop and note it
   as a proposed follow-up instead. The plan is the contract.
4. **When a decision isn't specified, prefer the boring, reversible option** and write down what you
   chose and why in the phase spec.

## Definition of Done (every task)

A task is done only when **all** are true:
- [ ] It meets the acceptance criteria written in the phase spec.
- [ ] TypeScript compiles with **no `any`-escapes** and strict mode on.
- [ ] Lint passes.
- [ ] For DB work: a migration exists, RLS policy is in the same migration, and generated types are
      updated.
- [ ] For a feature with logic: at least a happy-path test and one failure-path test.
- [ ] You verified it actually works by exercising the real flow (ran the endpoint / clicked the UI /
      called the MCP tool), not just that it compiles.
- [ ] Committed with a clear message; the phase checklist box is ticked.

## Non-negotiable rules

### Security & data
- **Never commit secrets.** All keys live in Supabase/Vercel env config. If you need a new secret,
  add it to `.env.example` with a placeholder and document it — never a real value.
- **RLS on every client-data table, in the creating migration.** No "add security later."
- **Every MCP tool is tenant-safe.** A tool must enforce the same org scoping as the UI. MCP is not a
  backdoor around RLS.
- **Mutating MCP tools write an `activities` row** (`actor_type='agent'`) so agent actions are
  auditable.

### AI layer (P3)
- **No feature imports a provider SDK directly.** All generation/embedding goes through
  `packages/ai`. Model IDs appear **only** in the routing config.
- **Pin real, current model IDs from provider docs** at build time. Do not hardcode a model name
  from memory — look it up. (If you have a skill/reference for Claude model IDs and pricing, use it.)
- **Prefer schema-validated (structured) output** for anything code consumes.

### Database
- Migrations are **forward-only and reviewed**; never edit a shipped migration — add a new one.
- Use `metadata jsonb` for genuinely variable fields; don't add a column per client whim.
- Keep the source of truth in Postgres. External systems sync **inbound** (P2).

### Code
- One language: **TypeScript, strict.** One feature per commit/PR where practical.
- Match existing patterns and file layout ([02-tech-stack.md](02-tech-stack.md)). Don't introduce a
  new library when an installed one does the job; if you must, justify it in the phase spec.
- Don't scaffold empty packages ahead of their phase.

## Git & branches
- Develop on the branch designated for this work; commit in small, descriptive increments.
- Descriptive commit messages: what changed and why, phase/task reference where useful.
- **Do not open a pull request unless explicitly asked.**

## When you're unsure
- Ambiguous requirement or an architecturally significant fork → **stop and ask the human**, with
  enough context to answer without digging. Don't guess on one-way doors.
- A small, reversible choice → make it, document it, keep moving.

## What "grounded" means (for AI features)
Any client-facing generated content or answer must be traceable to real data (a `client`, an
`activity`, a `document`). If retrieval returns nothing relevant, the correct behavior is to say so —
never invent client facts.

## Progress tracking
Keep the checklist in each phase spec and the status list in `README.md` current. The repo should
always answer "what's done and what's next" at a glance.
