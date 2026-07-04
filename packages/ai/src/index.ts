// packages/ai — the provider-agnostic LLM layer.
//
// The whole app calls generate / stream / generateStructured / embed from here and
// NOWHERE imports a provider SDK directly (P3). Which model runs is decided by the
// routing table in ./models.ts, so swapping Claude <-> OpenAI is a config change.

import {
  embed as aiEmbed,
  embedMany as aiEmbedMany,
  generateObject,
  generateText,
  streamText,
} from 'ai'
import type { EmbeddingModel, LanguageModel, ModelMessage } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import type { ZodType } from 'zod'
import { modelRouting, type Provider, type Task } from './models'

// --- Provider instances (the only place API keys are read) --------------------------
const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY })

interface ModelChoice {
  provider: Provider
  model: string
}

function languageModel({ provider, model }: ModelChoice): LanguageModel {
  switch (provider) {
    case 'anthropic':
      return anthropic(model)
    case 'openai':
      return openai(model)
  }
}

function embeddingModel({ provider, model }: ModelChoice): EmbeddingModel<string> {
  switch (provider) {
    case 'openai':
      return openai.textEmbeddingModel(model)
    case 'anthropic':
      throw new Error(
        "Anthropic has no embedding model — route the 'embed' task to a provider that does.",
      )
  }
}

/** Ordered list of model choices to try for a task: primary, then any fallbacks. */
function candidates(task: Task, override?: ModelChoice): ModelChoice[] {
  if (override) return [override]
  const route = modelRouting[task]
  return [{ provider: route.provider, model: route.model }, ...(route.fallbacks ?? [])]
}

/** Try each candidate in order; return the first success, or throw the last error. */
async function withFallback<T>(
  choices: ModelChoice[],
  run: (choice: ModelChoice) => Promise<T>,
): Promise<T> {
  let lastError: unknown
  for (const choice of choices) {
    try {
      return await run(choice)
    } catch (err) {
      lastError = err
    }
  }
  throw lastError
}

export interface GenerateArgs {
  task: Task
  messages: ModelMessage[]
  system?: string
  /** Override the routed model for this call. */
  model?: ModelChoice
  temperature?: number
}

/** Generate text for a task. Returns the completion string. */
export function generate(args: GenerateArgs): Promise<string> {
  return withFallback(candidates(args.task, args.model), async (choice) => {
    const { text } = await generateText({
      model: languageModel(choice),
      system: args.system,
      messages: args.messages,
      temperature: args.temperature,
    })
    return text
  })
}

/**
 * Generate schema-validated structured output for anything code consumes. The AI SDK
 * validates against the Zod schema and the model is re-prompted on mismatch.
 */
export function generateStructured<T>(
  args: GenerateArgs & { schema: ZodType<T> },
): Promise<T> {
  return withFallback(candidates(args.task, args.model), async (choice) => {
    const { object } = await generateObject({
      model: languageModel(choice),
      schema: args.schema,
      system: args.system,
      messages: args.messages,
      temperature: args.temperature,
    })
    return object
  })
}

/**
 * Stream text (for the chat UI). Returns the AI SDK streaming result — use
 * `.textStream` for tokens or `.toUIMessageStreamResponse()` in a route handler.
 * Streaming uses the primary model only (no mid-stream fallback).
 */
export function stream(args: GenerateArgs) {
  const [primary] = candidates(args.task, args.model)
  if (!primary) throw new Error(`No model configured for task: ${args.task}`)
  return streamText({
    model: languageModel(primary),
    system: args.system,
    messages: args.messages,
    temperature: args.temperature,
  })
}

/** Embed a single string. Dimension is fixed by the routed embedding model. */
export async function embed(text: string): Promise<number[]> {
  const route = modelRouting.embed
  const { embedding } = await aiEmbed({
    model: embeddingModel({ provider: route.provider, model: route.model }),
    value: text,
  })
  return embedding
}

/** Embed many strings in one call (batch ingestion). */
export async function embedMany(texts: string[]): Promise<number[][]> {
  const route = modelRouting.embed
  const { embeddings } = await aiEmbedMany({
    model: embeddingModel({ provider: route.provider, model: route.model }),
    values: texts,
  })
  return embeddings
}

export { modelRouting, EMBEDDING_DIMENSION } from './models'
export type { Task, Provider } from './models'
export type { ModelMessage } from 'ai'
