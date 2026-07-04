import { getDefaultOrganization, type Organization } from '@retentionos/db'

/**
 * Dev stand-in until auth lands (Phase 0.3): resolves the current org as the
 * default organization rather than from an authenticated session.
 */
export async function getCurrentOrg(): Promise<Organization> {
  const org = await getDefaultOrganization()
  if (!org) {
    throw new Error('No organization found. Has the database been seeded?')
  }
  return org
}
