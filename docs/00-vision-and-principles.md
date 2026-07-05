> ⚠️ **SUPERSEDED (2026-07-04).** This doc describes the pre-pivot build. The authoritative plan is now [08-course-correction.md](08-course-correction.md). Kept as historical record.

# 00 · Vision & Principles

## The vision

A retention agency where **the tools all work together, we own our data, we have great reporting,
and the data is easily chatted with.** Project management is agentically controlled. We produce
large volumes of data-backed emails and SMS. A CRM hosts all client data (channels, documents,
calendars — the stuff currently living in Airtable). And everything is easy to communicate with
via AI agents, flexibly, on Claude or OpenAI or any model we choose.

RetentionOS is the system that makes that real.

## What "AI-native" actually means here

Not "we bolted a chatbot on." It means:

1. **One data spine.** Every tool writes to and reads from the same owned database. No silos.
2. **Everything is a tool an agent can call.** Each capability is exposed through a standard
   interface (MCP), so an agent can *operate* the agency, not just answer questions about it.
3. **Everything is chattable.** Structured data (Postgres) + unstructured context (docs, Obsidian,
   Slack history) are both queryable in natural language.
4. **Model-agnostic.** We never hard-couple to one AI vendor. Swapping Claude ↔ OpenAI ↔ local is
   a config change, not a rewrite.

## Principles (the rules we don't break)

### P1 — Own the core, rent the edges
We own the **data layer** and the **AI orchestration**. We integrate best-in-class SaaS for the
edges (Slack, Google Calendar, email/SMS delivery, e-commerce/ad platforms). The test: *if a vendor
disappeared tomorrow, would we lose our data or just an integration?* It must always be "just an
integration."

### P2 — The database is the single source of truth
External systems (Airtable, Slack, Notion, calendars) are **mirrored into**, never authoritative
over, our Postgres. Sync flows inbound; our DB is canonical. This is what makes "we own our data"
literally true.

### P3 — Provider-agnostic AI, always
All model calls go through one internal interface. No feature imports the Anthropic or OpenAI SDK
directly. See [04-ai-and-agent-layer.md](04-ai-and-agent-layer.md).

### P4 — Every subsystem ships an MCP server
CRM, PM, content, reporting — each exposes its capabilities as MCP tools/resources. This is the
single most important architectural decision: it's what makes the whole agency uniformly drivable
by any agent, and it's what lets subsystems compose.

### P5 — Multi-tenant from line one
We're greenfield but scaling to 10+ clients fast. Every table that holds client data carries an
`organization_id` and is protected by row-level security from the first migration. Retrofitting
tenancy later is painful; we don't.

### P6 — Boring, well-supported tech
This is built by AI agents and a small team. Favor the stack with the most training data, the best
docs, and the least operational surprise. One language end-to-end. See
[02-tech-stack.md](02-tech-stack.md).

### P7 — Small, reversible, verifiable steps
Every phase is broken into tasks with explicit acceptance criteria. Prefer changes that can be
shipped and checked in isolation. See [07-working-agreement.md](07-working-agreement.md).

### P8 — Context lives in markdown, structured data lives in Postgres
Brand voice, SOPs, playbooks, client briefs → markdown (Obsidian-friendly, git-tracked, human-
editable). Clients, contacts, tasks, campaigns, metrics → Postgres. Both are ingested into the RAG
layer so both are chattable, but each has one clear home.

## Non-goals (for now)

- We are **not** building our own email delivery infrastructure or SMS carrier — we rent those.
- We are **not** building a general-purpose no-code platform. This is opinionated software for *our*
  agency, that could later be productized.
- We are **not** optimizing for scale we don't have. Design for 10–100 clients, not 10,000. Choices
  that are clean at 100 clients (Postgres, Supabase) also scale well past it, so this costs us
  nothing.
