// Shared adapter shape for every connector in this package. Each connector has two entry
// points: `syncFromFixture` (runs today, no external creds needed) and `syncLive` (the real
// API-fetch path — correct and typechecked, but gated behind credentials this dev environment
// doesn't have). Both funnel into the same row-mapping/upsert code so the two paths can never
// drift apart.

/** Aggregate counts returned by a sync/import run, for logging and verification. */
export interface SyncSummary {
  customers: number
  orders: number
  products: number
  events?: number
  segments?: number
}

/**
 * A source-system connector. `provider` is the value written into the `source` column on the
 * client_* tables (e.g. 'shopify', 'klaviyo').
 */
export interface Connector<TFixture, TCredentials> {
  provider: string
  syncFromFixture(orgId: string, clientId: string, fixture: TFixture): Promise<SyncSummary>
  syncLive(orgId: string, clientId: string, credentials: TCredentials): Promise<SyncSummary>
}
