# RetentionOS

An **owned, AI-native operating system for a retention agency.** One data spine that every
tool plugs into, dashboards on top, and — most importantly — the whole thing is chattable and
drivable by any AI model (Claude, OpenAI, or whatever comes next).

This repository currently contains **the plan**, written as a build handbook. It is designed to
be handed to a cheaper AI coding model (or a junior dev) who executes it phase by phase, checking
their work against the acceptance criteria in each doc.

## The one-paragraph thesis

We own the **core** (our data + our AI orchestration) and rent the **edges** (Slack, calendars,
email/SMS providers). Every subsystem — CRM, project management, content, reporting — is built on
one Postgres database and fronted by a **Model Context Protocol (MCP) server**, so any AI agent can
read and operate the entire agency through one consistent tool interface. Generation (writing
emails, summaries, etc.) goes through a **provider-agnostic layer** so we can swap models with a
config change. The endgame is a single "chat with everything" surface over all of it.

## How to read this repo (start here)

Read the docs **in order**. Each builds on the last.

| # | Doc | What it answers |
|---|-----|-----------------|
| 00 | [docs/00-vision-and-principles.md](docs/00-vision-and-principles.md) | Why we're building this and the rules we never break |
| 01 | [docs/01-architecture.md](docs/01-architecture.md) | The three planes and how data flows |
| 02 | [docs/02-tech-stack.md](docs/02-tech-stack.md) | Exact tools, versions, and why each was chosen |
| 03 | [docs/03-data-model.md](docs/03-data-model.md) | The core tables everything depends on |
| 04 | [docs/04-ai-and-agent-layer.md](docs/04-ai-and-agent-layer.md) | Provider-agnostic LLM + MCP (the "any model" magic) |
| 05 | [docs/05-roadmap.md](docs/05-roadmap.md) | The phase-by-phase build order and milestones |
| 06 | [docs/06-website.md](docs/06-website.md) | The marketing site (deliberately last) |
| 07 | [docs/07-working-agreement.md](docs/07-working-agreement.md) | **Rules for the AI/dev executing this plan. Read before writing code.** |

Then execute phases from `/phases`, starting with
[phases/phase-01-crm-foundation.md](phases/phase-01-crm-foundation.md).

## Build order at a glance

```
Phase 0  Foundations      repo, DB, auth, multi-tenant, provider-agnostic LLM, first MCP skeleton
Phase 1  Client CRM       ← THE WEDGE. Everything builds off this. Replaces Airtable.
Phase 2  Agentic PM       projects + tasks an agent can drive
Phase 3  Content Engine   data-backed email + SMS at volume
Phase 4  Reporting        dashboards over our own data
Phase 5  Data Backbone    "chat with everything" — the final boss
Phase 6  Website          public marketing site
```

## Status

- [x] Plan written
- [ ] Phase 0 — Foundations
- [ ] Phase 1 — Client CRM
- [ ] Phase 2 — Agentic Project Management
- [ ] Phase 3 — Content Engine
- [ ] Phase 4 — Reporting Dashboards
- [ ] Phase 5 — Data Backbone / Chat-with-everything
- [ ] Phase 6 — Website
