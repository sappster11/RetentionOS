import { query, queryOne } from './pool'
import type { Organization } from './types'

export async function listOrganizations(): Promise<Organization[]> {
  return query<Organization>(
    'select id, name, slug, created_at from public.organizations order by created_at asc',
  )
}

/**
 * Dev convenience: the current org until auth lands (Phase 0.3). Prefers DEV_ORG_ID,
 * else the first organization. In production this is replaced by the authed session's org.
 */
export async function getDefaultOrganization(): Promise<Organization | null> {
  const devId = process.env.DEV_ORG_ID
  if (devId) {
    return queryOne<Organization>(
      'select id, name, slug, created_at from public.organizations where id = $1',
      [devId],
    )
  }
  return queryOne<Organization>(
    'select id, name, slug, created_at from public.organizations order by created_at asc limit 1',
  )
}

export async function createOrganization(input: {
  name: string
  slug: string
}): Promise<Organization> {
  const row = await queryOne<Organization>(
    `insert into public.organizations (name, slug)
     values ($1, $2)
     returning id, name, slug, created_at`,
    [input.name, input.slug],
  )
  if (!row) throw new Error('Failed to create organization')
  return row
}
