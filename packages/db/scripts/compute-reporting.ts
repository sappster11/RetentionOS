// Resolves the default org, (re)computes client health scores, then captures a fresh round of
// metric_snapshots — see src/reporting.ts for the health-score heuristic and snapshot rows.
//
// Run: DATABASE_URL=postgres://... pnpm --filter @retentionos/db reporting

import { captureSnapshots, computeHealthScores, getDefaultOrganization } from '../src/index'

async function main() {
  const org = await getDefaultOrganization()
  if (!org) {
    console.error('No organization found — run `pnpm --filter @retentionos/db seed` first.')
    process.exit(1)
  }

  console.log(`Computing health scores for org "${org.name}"...`)
  const healths = await computeHealthScores(org.id)
  for (const health of healths) {
    console.log(
      health.health_score === null
        ? `  ${health.name}: no customer metrics yet — health left unchanged.`
        : `  ${health.name}: health_score = ${health.health_score}`,
    )
  }

  console.log('Capturing metric snapshots...')
  const snapshots = await captureSnapshots(org.id)
  const byMetric = new Map<string, number>()
  for (const snapshot of snapshots) {
    byMetric.set(snapshot.metric_key, (byMetric.get(snapshot.metric_key) ?? 0) + 1)
  }
  for (const [metricKey, count] of byMetric) {
    console.log(`  ${metricKey}: ${count} row(s)`)
  }

  console.log(`Done. Inserted ${snapshots.length} snapshot row(s).`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
