# 02 · Tech Stack

Chosen for a small team building with AI coding agents: **one language end-to-end**, maximum
training data and docs, minimal ops. Every choice traces back to a principle in
[00-vision-and-principles.md](00-vision-and-principles.md).

## The stack

| Layer | Choice | Why |
|-------|--------|-----|
| Language | **TypeScript** (strict) | One language for web, API, agents, and MCP. Best-supported ecosystem for the AI SDKs we need. |
| App framework | **Next.js** (App Router) | UI + API routes + server actions in one deployable. AI agents know it extremely well. |
| Database | **Postgres via Supabase** | Owned data (P1/P2), RLS for multi-tenancy (P5), `pgvector` built in, auth + storage included. Self-hostable later if we ever want to leave. |
| Vectors / RAG | **pgvector** (in the same Postgres) | No separate vector store to sync. Simpler ops, fast enough at our scale. |
| Auth | **Supabase Auth** | Team logins now; client-portal logins later without re-architecting. |
| File storage | **Supabase Storage** | S3-compatible, integrated with our auth/RLS. |
| LLM generation | **Vercel AI SDK** | Provider-agnostic by design — one API, swap Claude/OpenAI/others via config. Streaming, tool-calling, structured output built in. |
| Agent tooling | **Model Context Protocol (MCP)** | Open standard for exposing tools/resources to any agent. The core of our "any model" flexibility. |
| Background jobs | **Supabase scheduled functions** first; **Inngest** or **Trigger.dev** when workflows get complex | Start with cron-style; graduate to a durable workflow engine only when sync/retries demand it. |
| Email delivery | **Resend** (transactional) + a marketing ESP (**Customer.io** or **Klaviyo**) for campaigns | Rent delivery (P1). Resend is developer-friendly for transactional; a real ESP handles list mgmt, deliverability, unsubscribe for volume retention campaigns. |
| SMS | **Twilio** | Industry standard, best docs, easiest for AI agents to integrate. |
| Dashboards (fast) | **Metabase** (self-host, pointed at our Postgres) | Great dashboards over our own data on day one, no custom charting code. |
| Dashboards (in-app) | **Recharts / Tremor** inside Next.js | For client-facing, embedded reporting once we outgrow Metabase. |
| Context vault | **Obsidian** over a git-synced markdown folder | Human-editable brand voice / SOPs / briefs, ingested into RAG (P8). |
| Hosting | **Vercel** (app) + **Supabase Cloud** (data) | Zero-ops to start. Both have clean export/self-host paths, so P1 holds. |
| Package manager | **pnpm** | Fast, disk-efficient, monorepo-friendly. |
| Monorepo | **Turborepo** (only if/when we split packages) | Not required for Phase 0–1; adopt when we extract shared packages. |

## Repository layout (target)

Start as a single Next.js app; grow into a monorepo only when a second deployable appears (e.g. a
standalone MCP service or the marketing site).

```
RetentionOS/
├── docs/                     # this plan
├── phases/                   # phase-by-phase build specs
├── apps/
│   └── web/                  # Next.js app: UI + API + in-app agent runtime
├── packages/
│   ├── db/                   # Supabase schema, migrations, generated types
│   ├── ai/                   # provider-agnostic LLM layer (generate/embed/stream)
│   ├── mcp-crm/              # CRM MCP server
│   ├── mcp-pm/               # project-management MCP server
│   ├── mcp-content/          # content MCP server
│   ├── mcp-reporting/        # reporting MCP server
│   └── integrations/         # Slack, Google Calendar, ESP, Twilio adapters
└── context/                  # git-synced markdown vault (Obsidian points here)
```

> Phase 0 may start with just `apps/web` + `packages/db` + `packages/ai`. Add packages as their
> phase begins. Do **not** scaffold empty packages ahead of need.

## Provider accounts to create (checklist)

- [ ] Supabase project (Postgres + Auth + Storage)
- [ ] Vercel project (app hosting)
- [ ] Anthropic API key (Claude) — primary generation
- [ ] OpenAI API key — secondary/embeddings/fallback (proves provider-agnosticism early)
- [ ] Resend account (transactional email)
- [ ] Marketing ESP account (Customer.io or Klaviyo) — Phase 3
- [ ] Twilio account (SMS) — Phase 3
- [ ] Google Cloud project (Calendar API OAuth) — CRM/integration phase
- [ ] Slack app (OAuth + events) — CRM/integration phase

Store all secrets in Supabase/Vercel env config. **Never** commit keys. See the working agreement.

## Things we deliberately did NOT choose (and why)

- **A dedicated vector DB (Pinecone/Weaviate):** unnecessary at our scale; pgvector keeps data +
  vectors in one place.
- **Python backend:** would split our language surface and complicate the app/agent runtime. TS
  covers everything we need.
- **LangChain as the backbone:** too much abstraction churn. The Vercel AI SDK + our own thin layer
  + MCP is simpler and more stable. We can call specific libraries where genuinely useful.
- **Airtable as source of truth:** it stays only as a *migration source* and optional edge; our
  Postgres becomes canonical (P2).
