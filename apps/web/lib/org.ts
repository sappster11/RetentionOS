import { getDefaultOrganization, queryOne, type Organization } from '@retentionos/db'
import { authEnabled, getSessionUser } from './auth'

/**
 * Resolves the organization for an authenticated user via their membership row.
 * Returns null if the user has no membership (rather than throwing) so callers can
 * fall back to the dev stand-in org.
 */
async function getOrgForUser(userId: string): Promise<Organization | null> {
  return queryOne<Organization>(
    `select o.id, o.name, o.slug, o.created_at
     from public.organizations o
     join public.memberships m on m.organization_id = o.id
     where m.user_id = $1
     order by m.created_at asc
     limit 1`,
    [userId],
  )
}

/**
 * Resolves the current org. When auth is enabled and there is a session user with a
 * membership, that membership's org wins. Otherwise — auth disabled, no session, or an
 * authed user with no membership yet — this falls back to `getDefaultOrganization()`
 * exactly as before Phase 0.3, so local dev keeps working unchanged.
 */
export async function getCurrentOrg(): Promise<Organization> {
  if (authEnabled) {
    const user = await getSessionUser()
    if (user) {
      const org = await getOrgForUser(user.id)
      if (org) return org
    }
  }

  const org = await getDefaultOrganization()
  if (!org) {
    throw new Error('No organization found. Has the database been seeded?')
  }
  return org
}
