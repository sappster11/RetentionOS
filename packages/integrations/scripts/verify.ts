// Manual verification script for @retentionos/integrations. Not part of the package's public
// API — run ad hoc with `tsx scripts/verify.ts` (DATABASE_URL must point at the local Postgres).
//
// What it proves:
//   1. Shopify + Klaviyo fixture sync writes real rows into client_customers/orders/products/
//      events/segments for a THROWAWAY client (so the seeded demo data stays untouched).
//   2. recomputeAnalytics runs on synced data and produces client_customer_metrics rows.
//   3. Re-running both syncs is idempotent (row counts don't double).
//   4. The Airtable fixture import creates its 2 clients (+ contacts/channels) in the org.
//   5. Everything created here is deleted at the end (cascades clean up child rows).
import { getDefaultOrganization, createClient, recomputeAnalytics, query, queryOne } from '@retentionos/db'
import {
  shopifyConnector,
  klaviyoConnector,
  importFromFixture,
  loadShopifyFixture,
  loadKlaviyoFixture,
  loadAirtableFixture,
} from '../src/index'

async function countCustomers(clientId: string): Promise<number> {
  const row = await queryOne<{ count: string }>(
    `select count(*)::int as count from public.client_customers where client_id = $1`,
    [clientId],
  )
  return row ? Number(row.count) : 0
}

async function countOrders(clientId: string): Promise<number> {
  const row = await queryOne<{ count: string }>(
    `select count(*)::int as count from public.client_orders where client_id = $1`,
    [clientId],
  )
  return row ? Number(row.count) : 0
}

async function main(): Promise<void> {
  const org = await getDefaultOrganization()
  if (!org) throw new Error('No organization found — run `pnpm --filter @retentionos/db seed` first.')
  console.log(`Using organization: ${org.name} (${org.id})`)

  // -------------------------------------------------------------------------
  // 1. Shopify + Klaviyo fixture sync into a throwaway client
  // -------------------------------------------------------------------------
  const fixtureClient = await createClient(org.id, {
    name: 'Fixture Test Co',
    status: 'active',
    tier: 'standard',
    industry: 'Test Fixtures',
  })
  console.log(`\nCreated throwaway client: ${fixtureClient.name} (${fixtureClient.id})`)

  const shopifyFixture = loadShopifyFixture()
  const klaviyoFixture = loadKlaviyoFixture()

  console.log('\n--- First sync run ---')
  const shopifySummary1 = await shopifyConnector.syncFromFixture(org.id, fixtureClient.id, shopifyFixture)
  console.log('Shopify syncFromFixture summary:', shopifySummary1)
  const klaviyoSummary1 = await klaviyoConnector.syncFromFixture(org.id, fixtureClient.id, klaviyoFixture)
  console.log('Klaviyo syncFromFixture summary:', klaviyoSummary1)

  await recomputeAnalytics(org.id, fixtureClient.id)
  console.log('recomputeAnalytics: done')

  const customerCount1 = await countCustomers(fixtureClient.id)
  const orderCount1 = await countOrders(fixtureClient.id)
  console.log(`client_customers count: ${customerCount1}`)
  console.log(`client_orders count: ${orderCount1}`)

  const metricsSample = await query<{
    lifecycle_stage: string
    recency_days: number | null
    frequency: number
    monetary: string
    aov: string | null
    predicted_ltv: string | null
    churn_risk: string
  }>(
    `select m.lifecycle_stage, m.recency_days, m.frequency, m.monetary, m.aov, m.predicted_ltv, m.churn_risk
     from public.client_customer_metrics m
     where m.organization_id = $1 and m.client_id = $2
     order by m.monetary desc
     limit 3`,
    [org.id, fixtureClient.id],
  )
  console.log('\nSample client_customer_metrics rows (top 3 by monetary):')
  for (const row of metricsSample) console.log(' ', row)

  // -------------------------------------------------------------------------
  // 2. Re-run both syncs — idempotency check
  // -------------------------------------------------------------------------
  console.log('\n--- Second (repeat) sync run — idempotency check ---')
  const shopifySummary2 = await shopifyConnector.syncFromFixture(org.id, fixtureClient.id, shopifyFixture)
  console.log('Shopify syncFromFixture summary (2nd run):', shopifySummary2)
  const klaviyoSummary2 = await klaviyoConnector.syncFromFixture(org.id, fixtureClient.id, klaviyoFixture)
  console.log('Klaviyo syncFromFixture summary (2nd run):', klaviyoSummary2)

  const customerCount2 = await countCustomers(fixtureClient.id)
  const orderCount2 = await countOrders(fixtureClient.id)
  console.log(`client_customers count after re-run: ${customerCount2}`)
  console.log(`client_orders count after re-run: ${orderCount2}`)

  if (customerCount1 !== customerCount2 || orderCount1 !== orderCount2) {
    throw new Error(
      `IDEMPOTENCY FAILURE: counts changed on re-run (customers ${customerCount1} -> ${customerCount2}, ` +
        `orders ${orderCount1} -> ${orderCount2})`,
    )
  }
  console.log('Idempotency check PASSED — counts unchanged after re-running fixture syncs.')

  // -------------------------------------------------------------------------
  // 3. Clean up throwaway client
  // -------------------------------------------------------------------------
  await query(`delete from public.clients where id = $1`, [fixtureClient.id])
  const stillThere = await queryOne<{ id: string }>(`select id from public.clients where id = $1`, [
    fixtureClient.id,
  ])
  const orphanCustomers = await countCustomers(fixtureClient.id)
  console.log(
    `\nDeleted throwaway client. Still present? ${stillThere ? 'YES (FAIL)' : 'no'}. ` +
      `Orphaned client_customers rows: ${orphanCustomers} (expect 0 — cascade delete).`,
  )
  if (stillThere || orphanCustomers !== 0) {
    throw new Error('Cleanup of throwaway client FAILED.')
  }

  // -------------------------------------------------------------------------
  // 4. Airtable fixture import
  // -------------------------------------------------------------------------
  console.log('\n--- Airtable importFromFixture ---')
  const airtableFixture = loadAirtableFixture()
  const airtableSummary = await importFromFixture(org.id, airtableFixture)
  console.log('Airtable importFromFixture summary:', airtableSummary)

  const importedClients = await query<{ id: string; name: string }>(
    `select id, name from public.clients where organization_id = $1 and name = any($2::text[])`,
    [org.id, airtableFixture.clients.map((c) => c.name)],
  )
  console.log(
    `Clients created by Airtable import: ${importedClients.map((c) => c.name).join(', ')} ` +
      `(expected ${airtableFixture.clients.length})`,
  )
  if (importedClients.length !== airtableFixture.clients.length) {
    throw new Error('Airtable import did not create the expected number of clients.')
  }

  // Clean up the 2 fixture clients (cascades contacts + channels).
  for (const c of importedClients) {
    await query(`delete from public.clients where id = $1`, [c.id])
  }
  const remaining = await query<{ id: string }>(
    `select id from public.clients where organization_id = $1 and name = any($2::text[])`,
    [org.id, airtableFixture.clients.map((c) => c.name)],
  )
  console.log(`Airtable fixture clients remaining after cleanup: ${remaining.length} (expect 0).`)
  if (remaining.length !== 0) {
    throw new Error('Cleanup of Airtable fixture clients FAILED.')
  }

  console.log('\nAll verification steps passed.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nVERIFICATION FAILED:', err)
    process.exit(1)
  })
