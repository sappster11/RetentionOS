// Model routing — the single source of truth for which provider+model runs each task.
// P3: no feature imports a provider SDK directly; changing a model is a change *here* only.
//
// ⚠️ VERIFY MODEL IDS AT BUILD TIME against current provider docs before shipping. The IDs
// below are sensible defaults, not gospel. This table is the ONLY place they appear, so
// swapping a model — or an entire provider — for any task is a one-line edit.

export type Provider = 'anthropic' | 'openai'

/** Every distinct kind of generation the system does. Add tasks as phases need them. */
export type Task =
  | 'classify' // cheap, fast, structured
  | 'summarize' // mid-tier
  | 'draft_email' // strong, brand-voice, client-facing
  | 'draft_sms' // strong, brand-voice, client-facing
  | 'chat' // the chat-with-data surface
  | 'embed' // embeddings

export interface ModelRoute {
  provider: Provider
  model: string
  /** Optional ordered fallbacks for outages / rate limits (same shape). */
  fallbacks?: Array<{ provider: Provider; model: string }>
}

export const modelRouting: Record<Task, ModelRoute> = {
  classify: {
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    fallbacks: [{ provider: 'openai', model: 'gpt-4o-mini' }],
  },
  summarize: {
    provider: 'anthropic',
    model: 'claude-sonnet-5',
  },
  draft_email: {
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    fallbacks: [{ provider: 'openai', model: 'gpt-4o' }],
  },
  draft_sms: {
    provider: 'anthropic',
    model: 'claude-sonnet-5',
  },
  chat: {
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    fallbacks: [{ provider: 'openai', model: 'gpt-4o' }],
  },
  embed: {
    provider: 'openai',
    model: 'text-embedding-3-small', // 1536 dims — matches embeddings.vector(1536) in the DB
  },
}

/** Embedding vector dimension. MUST match the `vector(N)` column in migration 0002. */
export const EMBEDDING_DIMENSION = 1536
