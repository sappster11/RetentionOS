// Retention read service — the per-client analytics surface (docs/12 priority 1).
// Reads the parked pre-pivot analytics tables (0004: client_customer_metrics,
// client_cohorts, client_customers) through the 0013 bridge column that links an
// engine Clients record to its analytics client row.
//
// Server-side only (raw SQL via the shared pool). Degrades cleanly when the analytics
// migrations aren't applied (available: false) so engine-only environments never 500.

import { getPool } from '@retentionos/db'

export interface RetentionOverview {
  available: boolean
  provisioned: boolean
  hasData: boolean
  clientName: string
  totals: {
    customers: number
    revenue: number
    avgLtv: number | null
    avgChurnRisk: number | null
    atRisk: number
  }
  lifecycle: Array<{ stage: string; customers: number }>
  topCustomers: Array<{ name: string; email: string | null; monetary: number; ltv: number | null }>
  cohorts: Array<{ cohortKey: string; customers: number; periods: Array<number | null> }>
  computedAt: string | null
}

const EMPTY_TOTALS = { customers: 0, revenue: 0, avgLtv: null, avgChurnRisk: null, atRisk: 0 }

/** True when the parked analytics schema exists in this database. */
export async function analyticsAvailable(): Promise<boolean> {
  const pool = getPool()
  const res = await pool.query(
    `select to_regclass('public.client_customer_metrics') is not null as ok`,
  )
  return Boolean(res.rows[0]?.ok)
}

/** Find or lazily create the analytics client row bridged to an engine client record. */
export async function ensureAnalyticsClient(
  orgId: string,
  engineRecordId: string,
  name: string,
): Promise<string> {
  const pool = getPool()
  const existing = await pool.query(
    `select id from public.clients where organization_id = $1 and engine_record_id = $2`,
    [orgId, engineRecordId],
  )
  if (existing.rows[0]?.id) return existing.rows[0].id as string

  // Slug: derived + short suffix; the (org, slug) unique constraint is satisfied by the
  // suffix, and enum-typed columns keep their schema defaults.
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) +
    '-' +
    engineRecordId.slice(0, 8)
  const inserted = await pool.query(
    `insert into public.clients (organization_id, name, slug, engine_record_id)
     values ($1, $2, $3, $4)
     on conflict (engine_record_id) do update set name = excluded.name
     returning id`,
    [orgId, name, slug, engineRecordId],
  )
  return inserted.rows[0].id as string
}

/** The full overview payload for the Retention page. */
export async function retentionOverview(
  orgId: string,
  engineRecordId: string,
  clientName: string,
): Promise<RetentionOverview> {
  if (!(await analyticsAvailable())) {
    return {
      available: false,
      provisioned: false,
      hasData: false,
      clientName,
      totals: EMPTY_TOTALS,
      lifecycle: [],
      topCustomers: [],
      cohorts: [],
      computedAt: null,
    }
  }

  const clientId = await ensureAnalyticsClient(orgId, engineRecordId, clientName)
  const pool = getPool()

  const totalsRes = await pool.query(
    `select
       count(*)::int                                as customers,
       coalesce(sum(monetary), 0)::float            as revenue,
       avg(predicted_ltv)::float                    as avg_ltv,
       avg(churn_risk)::float                       as avg_churn,
       count(*) filter (where churn_risk >= 0.7)::int as at_risk,
       max(computed_at)                             as computed_at
     from public.client_customer_metrics
     where organization_id = $1 and client_id = $2`,
    [orgId, clientId],
  )
  const t = totalsRes.rows[0] ?? {}
  const customers: number = t.customers ?? 0

  const lifecycleRes = await pool.query(
    `select lifecycle_stage::text as stage, count(*)::int as customers
     from public.client_customer_metrics
     where organization_id = $1 and client_id = $2
     group by lifecycle_stage order by customers desc`,
    [orgId, clientId],
  )

  const topRes = await pool.query(
    `select coalesce(nullif(trim(concat(c.first_name, ' ', c.last_name)), ''), c.email, 'Unknown') as name,
            c.email, m.monetary::float as monetary, m.predicted_ltv::float as ltv
     from public.client_customer_metrics m
     join public.client_customers c on c.id = m.customer_id
     where m.organization_id = $1 and m.client_id = $2
     order by m.monetary desc limit 5`,
    [orgId, clientId],
  )

  // Last 6 cohorts × periods 0..6, retained % (null when the period has no row yet).
  const cohortRes = await pool.query(
    `select cohort_key::text, period_index, customers, retained
     from public.client_cohorts
     where organization_id = $1 and client_id = $2
       and cohort_key >= (select coalesce(max(cohort_key), '1970-01-01'::date) from public.client_cohorts
                          where organization_id = $1 and client_id = $2) - interval '5 months'
       and period_index <= 6
     order by cohort_key desc, period_index asc`,
    [orgId, clientId],
  )
  const cohortMap = new Map<string, { customers: number; periods: Array<number | null> }>()
  for (const row of cohortRes.rows) {
    const key = String(row.cohort_key).slice(0, 7)
    const entry = cohortMap.get(key) ?? { customers: 0, periods: Array(7).fill(null) }
    if (row.period_index === 0) entry.customers = row.customers
    if (row.period_index >= 0 && row.period_index <= 6 && row.customers > 0) {
      entry.periods[row.period_index] = Math.round((row.retained / row.customers) * 100)
    }
    cohortMap.set(key, entry)
  }

  return {
    available: true,
    provisioned: true,
    hasData: customers > 0,
    clientName,
    totals: {
      customers,
      revenue: t.revenue ?? 0,
      avgLtv: t.avg_ltv ?? null,
      avgChurnRisk: t.avg_churn ?? null,
      atRisk: t.at_risk ?? 0,
    },
    lifecycle: lifecycleRes.rows.map((r) => ({ stage: r.stage, customers: r.customers })),
    topCustomers: topRes.rows.map((r) => ({
      name: r.name,
      email: r.email ?? null,
      monetary: r.monetary ?? 0,
      ltv: r.ltv ?? null,
    })),
    cohorts: [...cohortMap.entries()].map(([cohortKey, v]) => ({ cohortKey, ...v })),
    computedAt: t.computed_at ? new Date(t.computed_at).toISOString() : null,
  }
}
