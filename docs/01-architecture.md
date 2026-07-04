# 01 · Architecture

RetentionOS is organized into **three planes**. Keep them mentally separate; most design mistakes
come from blurring them.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  INTELLIGENCE PLANE  (owned)                                               │
│                                                                            │
│   Provider-agnostic LLM layer          MCP servers (one per subsystem)     │
│   generate() · embed() · stream()      crm · pm · content · reporting      │
│            │                                    │                          │
│            │  reads/writes via the same tools any external agent uses      │
│            ▼                                    ▼                          │
├──────────────────────────────────────────────────────────────────────────┤
│  DATA PLANE  (owned — single source of truth)                              │
│                                                                            │
│   Postgres (Supabase)   +   pgvector (embeddings)   +   Storage (files)    │
│   organizations · clients · contacts · channels · documents · projects ·  │
│   tasks · messages · campaigns · metrics · integrations · activities       │
├──────────────────────────────────────────────────────────────────────────┤
│  INTEGRATION PLANE  (rented — mirrored inbound, never authoritative)       │
│                                                                            │
│   Slack · Google Calendar · Email/ESP · Twilio SMS · (later) Shopify /     │
│   Klaviyo / ad platforms · Obsidian vault (markdown context)               │
└──────────────────────────────────────────────────────────────────────────┘
```

## Data plane (owned core)

A single Postgres database (via Supabase) is the source of truth for **all structured data**. It
carries:

- **Relational tables** for every entity (see [03-data-model.md](03-data-model.md)).
- **`pgvector`** columns/tables for embeddings, so semantic search and RAG live *in the same
  database* as the data — no separate vector store to keep in sync.
- **Supabase Storage** for files (uploaded docs, exports, generated assets).
- **Row-Level Security (RLS)** enforcing multi-tenancy on every client-data table.

Why one database for both structured data and vectors: it removes an entire class of
consistency bugs, keeps ops simple, and pgvector is more than fast enough at our scale.

## Integration plane (rented edges)

Connectors that pull external data **into** the data plane and push actions **out**:

- **Inbound sync**: a Slack channel's messages, a client's calendar events, campaign performance
  from an ESP — mirrored into our tables on a schedule or via webhooks.
- **Outbound actions**: send an email through the ESP, fire an SMS via Twilio, post to a Slack
  channel.

Every connector is isolated behind an adapter interface so one failing vendor can't take down the
system, and swapping (e.g. one ESP for another) is contained.

**Obsidian** sits here too, but as a *context source*: a git-synced vault of markdown (brand voice,
SOPs, client briefs) that gets ingested into the RAG layer. Humans edit markdown; the system reads
it.

## Intelligence plane (owned AI)

Two neutral interfaces, both provider-agnostic. This plane is the "AI-native" part.

### 1. Generation — the LLM layer
A thin internal module every feature calls to generate text, embeddings, or structured output.
Model selection is config-driven, so we can route different tasks to different models/providers
(e.g. cheap model for classification, strong model for client-facing copy) and swap vendors without
touching feature code. Details in [04-ai-and-agent-layer.md](04-ai-and-agent-layer.md).

### 2. Action & access — MCP servers
Each subsystem publishes a **Model Context Protocol** server exposing its capabilities as tools
(`create_client`, `list_overdue_tasks`, `draft_campaign`…) and resources (`client://{id}`). The
same MCP servers are consumed by:

- our own in-app agent runtime,
- Claude Desktop / Claude Code,
- OpenAI's Agents SDK (native MCP support) or via a thin function-tool adapter,
- any future agent that speaks MCP.

**This is the flexibility you asked for.** "Works with Claude or OpenAI or any model" isn't a
feature we build per-vendor — it falls out of the architecture: generation is abstracted, and
actions are exposed through an open standard.

## How a request flows (concrete example)

> "Draft this month's win-back email for Client X using their recent activity, and create a task to
> review it."

1. An agent (Claude, OpenAI, or our app) receives the request.
2. It calls the **CRM MCP** `get_client` + `search_activities` tools → reads Client X's data from
   the **data plane**.
3. It calls the **content MCP** `draft_campaign` tool, which uses the **LLM layer** (`generate()`)
   with the client's brand-voice context (pulled from RAG over Obsidian + docs).
4. The draft is written back to the **data plane** (`campaigns` table).
5. It calls the **PM MCP** `create_task` tool → a review task appears, owned by a team member.
6. Nothing in this flow is vendor-specific. Change the model in config, everything still works.

## Deployment shape (start simple)

- One **Next.js** app (web UI + API routes + in-app agent runtime).
- **Supabase** hosts Postgres, auth, storage, and edge functions.
- MCP servers run as small Node processes (locally during dev; as deployed services or serverless
  functions in production). Start co-located; split out only if load demands it.
- Background sync/jobs via Supabase scheduled functions or a lightweight queue (see stack doc).

Don't over-engineer deployment early. A single app + Supabase gets us to 10+ clients comfortably.
