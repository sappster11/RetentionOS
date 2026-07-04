'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import {
  addMessage,
  createConversation,
  getConversation,
  searchEverything,
  type SearchHit,
  type SearchHitType,
} from '@retentionos/db'
import { generate } from '@retentionos/ai'
import { getCurrentOrg } from '@/lib/org'

function requireString(formData: FormData, field: string): string {
  const value = formData.get(field)
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required field: ${field}`)
  }
  return value.trim()
}

function optionalString(formData: FormData, field: string): string | undefined {
  const value = formData.get(field)
  if (typeof value !== 'string' || value.trim() === '') return undefined
  return value.trim()
}

/** The shape citations are stored in on assistant messages — the top search hits,
 *  trimmed to what the chat UI needs to render a citation chip. Stored as `unknown[]`
 *  on ConversationMessage (see packages/db/src/types.ts), so callers reading messages
 *  back must narrow before use — see app/chat/page.tsx#isCitation. */
export interface Citation {
  title: string
  url: string
  type: SearchHitType
}

function toCitations(hits: SearchHit[]): Citation[] {
  return hits.map((hit) => ({ title: hit.title, url: hit.url, type: hit.type }))
}

const TYPE_LABELS: Record<SearchHitType, string> = {
  client: 'client',
  contact: 'contact',
  document: 'document',
  task: 'task',
  campaign: 'campaign',
  customer: 'customer',
  activity: 'activity',
}

/**
 * Deterministic fallback answer used whenever the LLM call fails or isn't configured
 * (no ANTHROPIC_API_KEY / OPENAI_API_KEY in this environment): a one-line summary of
 * counts_by_type, followed by the top hits as a bulleted list. Once a key is available,
 * askAction below prefers a real generated answer over this.
 */
function composeFallbackAnswer(
  queryText: string,
  hits: SearchHit[],
  countsByType: Record<SearchHitType, number>,
): string {
  const totalHits = Object.values(countsByType).reduce((sum, count) => sum + count, 0)
  if (totalHits === 0) {
    return `I couldn't find anything matching "${queryText}". Try a different term or check spelling.`
  }

  const countsSummary = (Object.entries(countsByType) as Array<[SearchHitType, number]>)
    .filter(([, count]) => count > 0)
    .map(([type, count]) => `${count} ${TYPE_LABELS[type]}${count === 1 ? '' : 's'}`)
    .join(', ')

  const bullets = hits
    .map(
      (hit) =>
        `- **${hit.title}** (${TYPE_LABELS[hit.type]}) — ${hit.snippet ?? 'no preview available'}`,
    )
    .join('\n')

  return `Found ${countsSummary} matching "${queryText}":\n\n${bullets}`
}

export async function askAction(formData: FormData): Promise<void> {
  const org = await getCurrentOrg()
  const questionText = requireString(formData, 'q')
  const existingConversationId = optionalString(formData, 'conversation_id')

  const conversation = existingConversationId
    ? await getConversation(org.id, existingConversationId)
    : await createConversation(org.id, { title: questionText.slice(0, 60) })
  if (!conversation) throw new Error('Conversation not found')

  await addMessage(org.id, {
    conversation_id: conversation.id,
    role: 'user',
    content: questionText,
  })

  const { hits, counts_by_type } = await searchEverything(org.id, questionText, { limit: 12 })

  let answer: string
  try {
    answer = await generate({
      task: 'chat',
      system:
        "You are RetentionOS's analyst. Answer using ONLY the provided search results; cite sources.",
      messages: [
        {
          role: 'user',
          content: `${questionText}\n\nSearch results:\n${JSON.stringify(hits)}`,
        },
      ],
    })
  } catch {
    // No LLM key configured in this environment (or the provider call failed) — fall
    // back to a deterministic answer composed directly from the search hits.
    answer = composeFallbackAnswer(questionText, hits, counts_by_type)
  }

  await addMessage(org.id, {
    conversation_id: conversation.id,
    role: 'assistant',
    content: answer,
    citations: toCitations(hits),
  })

  revalidatePath('/chat')
  redirect(`/chat?c=${conversation.id}`)
}
