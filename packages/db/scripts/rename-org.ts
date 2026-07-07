// Rename the default organization (the workspace name shown in the app header).
//
// Run: DATABASE_URL=postgres://... pnpm --filter @retentionos/db rename:org "Roam"

import { getDefaultOrganization } from '../src/index'
import { query } from '../src/pool'

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.')
  const name = process.argv[2]?.trim()
  if (!name) throw new Error('Usage: pnpm --filter @retentionos/db rename:org "New Name"')

  const org = await getDefaultOrganization()
  if (!org) throw new Error('No organization exists to rename.')

  await query(`update public.organizations set name = $1 where id = $2`, [name, org.id])
  console.log(`Organization renamed: "${org.name}" -> "${name}"`)
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err.message ?? err)
    process.exit(1)
  },
)
