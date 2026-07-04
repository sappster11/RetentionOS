// Resolves the default org + its clients and (re)computes derived retention analytics
// (client_customer_metrics, client_cohorts) for each — see src/clientData.ts#recomputeAnalytics
// for the v1 RFM/lifecycle rules.
//
// Run: DATABASE_URL=postgres://... pnpm --filter @retentionos/db analytics

import { getDefaultOrganization, listClients, recomputeAnalytics } from '../src/index'

async function main() {
  const org = await getDefaultOrganization()
  if (!org) {
    console.error('No organization found — run `pnpm --filter @retentionos/db seed` first.')
    process.exit(1)
  }

  const clients = await listClients(org.id, { includeArchived: false })
  if (clients.length === 0) {
    console.error('No clients found for org — run `pnpm --filter @retentionos/db seed` first.')
    process.exit(1)
  }

  console.log(`Recomputing analytics for org "${org.name}" (${clients.length} clients)...`)
  for (const client of clients) {
    await recomputeAnalytics(org.id, client.id)
    console.log(`  ${client.name}: recomputed.`)
  }
  console.log('Done.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
