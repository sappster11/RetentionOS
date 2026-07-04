# 04 · AI & Agent Layer

This is the doc that makes "flexible with Claude or OpenAI or any model" real. There are **two
independent abstractions**. Don't conflate them.

1. **Generation** — producing text/embeddings/structured output. Provider-agnostic via one internal
   module.
2. **Action & access** — letting agents read and operate the system. Provider-agnostic via **MCP**.

You can build (1) without (2) and vice versa, but together they're the whole intelligence plane.

---

## Part 1 — The provider-agnostic LLM layer (`packages/ai`)

### The rule
**No feature ever imports `@anthropic-ai/sdk` or `openai` directly.** Everything goes through
`packages/ai`. This is what lets us swap models with a config change (P3).

### The interface (target shape)
Built on the **Vercel AI SDK**, which already abstracts providers. We add a thin config + routing
layer on top so *task → model* is a lookup, not hardcoded per call site.

```ts
// packages/ai — conceptual surface, not final code
type Task =
  | 'classify'        // cheap, fast
  | 'draft_email'     // strong, brand-voice
  | 'draft_sms'
  | 'summarize'
  | 'chat'            // the chat-with-data surface
  | 'embed'

interface GenerateArgs {
  task: Task
  messages: Message[]
  model?: ModelId          // optional override; else resolved from config by task
  temperature?: number
  tools?: ToolSet          // MCP tools can be surfaced here (see Part 2)
  schema?: ZodSchema       // when set → structured output
}

// The whole app calls these three:
generate(args): Promise<Result>          // text or structured
stream(args): AsyncIterable<Chunk>       // streaming for chat/UI
embed(text | text[]): Promise<number[][]>
```

### Model routing (config, not code)
A single config maps each task to a provider+model, with fallbacks. Changing which model writes
client emails is a one-line edit.

```ts
// config/models.ts — illustrative
export const modelRouting = {
  classify:    { provider: 'openai',    model: 'gpt-cheap-tier' },
  draft_email: { provider: 'anthropic', model: 'claude-strong-tier' },
  draft_sms:   { provider: 'anthropic', model: 'claude-strong-tier' },
  summarize:   { provider: 'anthropic', model: 'claude-mid-tier' },
  chat:        { provider: 'anthropic', model: 'claude-strong-tier' },
  embed:       { provider: 'openai',    model: 'text-embedding-tier' },
  // fallbacks[] per task for outages / rate limits
}
```
> Pin exact model IDs at build time from current provider docs — do **not** hardcode a memorized
> model name. The routing table is the only place model IDs appear.

### Structured output
Prefer schema-validated output (Zod) for anything the system consumes programmatically (e.g. a
classification, an extracted field). The AI SDK validates and retries on mismatch, so downstream
code gets typed data, not free text.

### RAG (retrieval-augmented generation)
"Chat with your data" = retrieval over `embeddings` (pgvector) + generation:

1. Embed the user's question (`embed`).
2. Vector-search `embeddings` scoped to the caller's `organization_id` (and often a `client_id`).
3. Assemble the top chunks as context.
4. `generate({ task: 'chat', ... })` with that context + the question.
5. Return the answer with citations back to source rows (`source_type`/`source_id`).

Ingestion (what fills `embeddings`): a job that chunks + embeds new/changed `documents`, activity
summaries, and the Obsidian markdown vault. Start simple — a single ingestion function invoked on
write and on a schedule.

---

## Part 2 — MCP: the "any agent can operate the agency" layer

### What MCP gives us
[Model Context Protocol](https://modelcontextprotocol.io) is an open standard for exposing **tools**
(actions) and **resources** (readable data) to AI agents. Build an MCP server once and it works with
Claude Desktop, Claude Code, OpenAI's Agents SDK, our own runtime, and anything else that speaks the
protocol. **This is why "works with any model" is architecture, not per-vendor engineering.**

### One MCP server per subsystem
Each subsystem package ships a server. They compose — an agent can hold all of them at once.

| Server | Example tools | Example resources |
|--------|---------------|-------------------|
| `mcp-crm` | `list_clients`, `get_client`, `search_clients`, `create_client`, `update_client`, `add_note`, `link_channel`, `list_contacts` | `client://{id}`, `contact://{id}` |
| `mcp-pm` | `list_tasks`, `create_task`, `update_task`, `assign_task`, `list_overdue` | `project://{id}`, `task://{id}` |
| `mcp-analytics` | `client_retention_overview`, `list_segment`, `customer_metrics`, `cohort_retention`, `product_performance` | `retention://{clientId}` |
| `mcp-content` | `draft_campaign`, `draft_sms`, `list_templates`, `personalize`, `queue_send` | `campaign://{id}`, `template://{id}` |
| `mcp-reporting` | `client_health`, `retention_metrics`, `run_report` | `report://{name}` |

### Design rules for tools
- **Tenant-safe:** every tool takes/derives an org context and enforces RLS. An MCP tool must never
  be a way around row-level security.
- **Idempotent where possible**, and mutations return the resulting record so the agent can verify.
- **Typed inputs** (JSON Schema) with tight descriptions — the description *is* the prompt the model
  reads. Write them well.
- **Read/write split is explicit**, so we can grant a read-only agent safely.
- **Auditable:** every mutating tool writes an `activities` row (`actor_type = 'agent'`).

### Consuming MCP from each vendor
- **Claude (Anthropic):** native MCP client (Claude Desktop/Code, and the API's MCP support).
- **OpenAI:** the Agents SDK / Responses API supports MCP servers directly; where it doesn't fit, a
  ~30-line adapter exposes each MCP tool as an OpenAI function tool.
- **Our own app runtime:** an in-app agent loop that loads the MCP servers and drives them, using
  the `generate`/`stream` layer for the model calls. Provider chosen by config.

### The payoff, restated
- Swap the *model* → change `config/models.ts`.
- Swap the *agent host* (Claude Desktop ↔ our app ↔ OpenAI) → point it at the same MCP servers.
- Add a *capability* → add a tool to the relevant MCP server; every agent gets it for free.

---

## Build order for this layer (mirrors the roadmap)

1. **Phase 0:** `packages/ai` with `generate`/`embed` + model routing config, proven against **two**
   providers (Anthropic + OpenAI) so provider-agnosticism is real, not aspirational. Stand up a
   minimal `mcp-crm` skeleton with one read tool.
2. **Phase 1:** flesh out `mcp-crm` (full CRUD + search), add RAG chat over CRM data.
3. **Phases 2–4:** each subsystem adds its MCP server as it's built.
4. **Phase 5:** unify retrieval across everything into the single chat surface.
