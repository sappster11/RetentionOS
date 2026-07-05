// Test fixtures: ensure a throwaway organization exists to scope engine calls against.
// Requires DATABASE_URL to point at a Postgres with migrations 0001 + 0009 applied.
import { queryOne } from '@retentionos/db'

export async function ensureTestOrg(): Promise<string> {
  const slug = `engine-test-${Math.random().toString(36).slice(2, 8)}`
  const row = await queryOne<{ id: string }>(
    `insert into public.organizations (name, slug) values ($1, $2) returning id`,
    ['Engine Test Org', slug],
  )
  if (!row) throw new Error('Failed to create test org')
  return row.id
}

export function actor(type: 'user' | 'agent' | 'api' = 'user', id?: string) {
  return { type, id }
}
