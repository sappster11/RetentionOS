import { query } from './pool'
import type { SearchHit, SearchHitType } from './types'

const SUB_LIMIT = 10
const DEFAULT_LIMIT = 30
const SNIPPET_RADIUS = 80

export interface SearchEverythingOptions {
  clientId?: string
  limit?: number
}

export interface SearchEverythingResult {
  hits: SearchHit[]
  counts_by_type: Record<SearchHitType, number>
}

interface ClientRow {
  id: string
  name: string
  industry: string | null
}
interface ContactRow {
  id: string
  client_id: string
  full_name: string
  email: string | null
}
interface DocumentRow {
  id: string
  client_id: string | null
  title: string
  content: string | null
}
interface TaskRow {
  id: string
  client_id: string | null
  title: string
  details: string | null
}
interface CampaignRow {
  id: string
  client_id: string
  name: string
}
interface CustomerRow {
  id: string
  client_id: string
  email: string | null
  first_name: string | null
  last_name: string | null
}
interface ActivityRow {
  id: string
  client_id: string | null
  verb: string
  summary: string | null
}

/**
 * A ~160-char window around the first case-insensitive match of `needle` in `haystack`,
 * with ellipses where the window is truncated. Falls back to the first 160 chars of
 * `haystack` if there's no direct substring match (e.g. it matched a different column),
 * and to `fallback` (the title) if `haystack` is empty.
 */
function snippetAround(haystack: string | null, needle: string, fallback: string): string {
  if (!haystack) return fallback
  const idx = haystack.toLowerCase().indexOf(needle.toLowerCase())
  if (idx === -1) return haystack.length > 160 ? `${haystack.slice(0, 160)}…` : haystack
  const start = Math.max(0, idx - SNIPPET_RADIUS)
  const end = Math.min(haystack.length, idx + needle.length + SNIPPET_RADIUS)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < haystack.length ? '…' : ''
  return `${prefix}${haystack.slice(start, end).trim()}${suffix}`
}

/**
 * The keyless unified retrieval spine for "chat with everything" (Phase 6): a single
 * tenant-scoped ILIKE fan-out across every entity table that can answer a question,
 * combined into one ranked list of SearchHit. This is intentionally simple (no
 * embeddings/ranking model) — see packages/db/scripts/ingest-context.ts for the note on
 * layering pgvector similarity search in once an embeddings key is configured.
 */
export async function searchEverything(
  orgId: string,
  queryText: string,
  opts: SearchEverythingOptions = {},
): Promise<SearchEverythingResult> {
  const like = `%${queryText}%`
  const limit = opts.limit ?? DEFAULT_LIMIT
  // Every subquery is scoped to organization_id ($1) and the search term ($2). When a
  // clientId is given, each subquery is additionally scoped to it ($3) — via `id` for the
  // clients table (is *this* the client being asked about?) and `client_id` elsewhere.
  const params: unknown[] = [orgId, like]
  if (opts.clientId) params.push(opts.clientId)
  const clientScope = (column: string) => (opts.clientId ? `and ${column} = $3` : '')

  const [clients, contacts, documents, tasks, campaigns, customers, activities] = await Promise.all([
    query<ClientRow>(
      `select id, name, industry from public.clients
       where organization_id = $1 and archived_at is null
         and (name ilike $2 or industry ilike $2)
         ${clientScope('id')}
       order by name asc limit ${SUB_LIMIT}`,
      params,
    ),
    query<ContactRow>(
      `select id, client_id, full_name, email from public.contacts
       where organization_id = $1
         and (full_name ilike $2 or email ilike $2)
         ${clientScope('client_id')}
       order by full_name asc limit ${SUB_LIMIT}`,
      params,
    ),
    query<DocumentRow>(
      `select id, client_id, title, content from public.documents
       where organization_id = $1
         and (title ilike $2 or content ilike $2)
         ${clientScope('client_id')}
       order by created_at desc limit ${SUB_LIMIT}`,
      params,
    ),
    query<TaskRow>(
      `select id, client_id, title, details from public.tasks
       where organization_id = $1
         and (title ilike $2 or details ilike $2)
         ${clientScope('client_id')}
       order by created_at desc limit ${SUB_LIMIT}`,
      params,
    ),
    query<CampaignRow>(
      `select id, client_id, name from public.campaigns
       where organization_id = $1 and name ilike $2
         ${clientScope('client_id')}
       order by created_at desc limit ${SUB_LIMIT}`,
      params,
    ),
    query<CustomerRow>(
      `select id, client_id, email, first_name, last_name from public.client_customers
       where organization_id = $1
         and (email ilike $2 or first_name ilike $2 or last_name ilike $2)
         ${clientScope('client_id')}
       order by created_at desc limit ${SUB_LIMIT}`,
      params,
    ),
    query<ActivityRow>(
      `select id, client_id, verb, summary from public.activities
       where organization_id = $1
         and (summary ilike $2 or verb ilike $2)
         ${clientScope('client_id')}
       order by occurred_at desc limit ${SUB_LIMIT}`,
      params,
    ),
  ])

  const combined: SearchHit[] = [
    ...clients.map(
      (row): SearchHit => ({
        type: 'client',
        id: row.id,
        client_id: row.id,
        title: row.name,
        snippet: row.industry,
        url: `/clients/${row.id}`,
      }),
    ),
    ...contacts.map(
      (row): SearchHit => ({
        type: 'contact',
        id: row.id,
        client_id: row.client_id,
        title: row.full_name,
        snippet: row.email,
        url: `/clients/${row.client_id}`,
      }),
    ),
    ...documents.map(
      (row): SearchHit => ({
        type: 'document',
        id: row.id,
        client_id: row.client_id,
        title: row.title,
        snippet: snippetAround(row.content, queryText, row.title),
        // Agency-wide documents (client_id null, e.g. ingested Obsidian notes) have no
        // client page to link to — fall back to a document-scoped URL for those.
        url: row.client_id ? `/clients/${row.client_id}` : `/documents/${row.id}`,
      }),
    ),
    ...tasks.map(
      (row): SearchHit => ({
        type: 'task',
        id: row.id,
        client_id: row.client_id,
        title: row.title,
        snippet: row.details ? snippetAround(row.details, queryText, row.title) : null,
        url: row.client_id ? `/clients/${row.client_id}/tasks` : `/tasks`,
      }),
    ),
    ...campaigns.map(
      (row): SearchHit => ({
        type: 'campaign',
        id: row.id,
        client_id: row.client_id,
        title: row.name,
        snippet: null,
        url: `/clients/${row.client_id}/campaigns/${row.id}`,
      }),
    ),
    ...customers.map(
      (row): SearchHit => ({
        type: 'customer',
        id: row.id,
        client_id: row.client_id,
        title: [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email || 'Customer',
        snippet: row.email,
        url: `/clients/${row.client_id}/retention`,
      }),
    ),
    ...activities.map(
      (row): SearchHit => ({
        type: 'activity',
        id: row.id,
        client_id: row.client_id,
        title: row.verb,
        snippet: row.summary,
        url: row.client_id ? `/clients/${row.client_id}` : `/activities`,
      }),
    ),
  ]

  // counts_by_type reflects every match found (across all subqueries, before the final
  // cap), so a caller can tell "there were 14 document hits" even when only a handful
  // made it into the capped `hits` array below.
  const counts_by_type: Record<SearchHitType, number> = {
    client: 0,
    contact: 0,
    document: 0,
    task: 0,
    campaign: 0,
    customer: 0,
    activity: 0,
  }
  for (const hit of combined) counts_by_type[hit.type]++

  return { hits: combined.slice(0, limit), counts_by_type }
}
