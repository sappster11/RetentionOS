// Derived retention analytics + tenant-scoped reads over the client commerce/engagement
// mirrors (migration 0004_client_data.sql). Raw sync writes (Shopify/Klaviyo ingestion) are
// out of scope here — this module is reads plus the recompute job that materializes
// client_customer_metrics / client_cohorts from the raw tables.

import { getPool, query, queryOne } from './pool'
import type {
  ClientCohort,
  ClientCustomer,
  ClientCustomerMetric,
  LifecycleStageCustomer,
} from './types'

const LIFECYCLE_STAGES: readonly LifecycleStageCustomer[] = [
  'new',
  'active',
  'at_risk',
  'churned',
  'won_back',
  'vip',
]

// ---------------------------------------------------------------------------
// getRetentionOverview
// ---------------------------------------------------------------------------

export interface RetentionOverview {
  totalCustomers: number
  totalRevenue: number
  avgAov: number
  lifecycleCounts: Record<LifecycleStageCustomer, number>
}

interface OverviewTotalsRow {
  total_customers: number
  total_revenue: number
  avg_aov: number
}

interface LifecycleCountRow {
  lifecycle_stage: LifecycleStageCustomer
  count: number
}

/** Tenant-scoped: customer counts, revenue and lifecycle-stage breakdown for one client. */
export async function getRetentionOverview(
  orgId: string,
  clientId: string,
): Promise<RetentionOverview> {
  const totals = await queryOne<OverviewTotalsRow>(
    `select
       count(*)::int as total_customers,
       coalesce(sum(total_spent), 0)::float8 as total_revenue,
       case when coalesce(sum(orders_count), 0) = 0 then 0
            else (sum(total_spent) / sum(orders_count))::float8 end as avg_aov
     from public.client_customers
     where organization_id = $1 and client_id = $2`,
    [orgId, clientId],
  )

  const lifecycleRows = await query<LifecycleCountRow>(
    `select lifecycle_stage, count(*)::int as count
     from public.client_customer_metrics
     where organization_id = $1 and client_id = $2
     group by lifecycle_stage`,
    [orgId, clientId],
  )

  const lifecycleCounts = Object.fromEntries(
    LIFECYCLE_STAGES.map((stage) => [stage, 0]),
  ) as Record<LifecycleStageCustomer, number>
  for (const row of lifecycleRows) {
    lifecycleCounts[row.lifecycle_stage] = row.count
  }

  return {
    totalCustomers: totals?.total_customers ?? 0,
    totalRevenue: totals?.total_revenue ?? 0,
    avgAov: totals?.avg_aov ?? 0,
    lifecycleCounts,
  }
}

// ---------------------------------------------------------------------------
// listSegmentCustomers
// ---------------------------------------------------------------------------

const CUSTOMER_COLUMNS = `
  cc.id, cc.organization_id, cc.client_id, cc.source, cc.external_id,
  cc.email, cc.phone, cc.first_name, cc.last_name,
  cc.first_order_at, cc.last_order_at, cc.orders_count, cc.total_spent,
  cc.klaviyo_profile_id, cc.email_consent, cc.sms_consent, cc.metadata,
  cc.created_at, cc.updated_at
`

/** Tenant-scoped: customers currently in a given lifecycle-stage "segment", richest first. */
export async function listSegmentCustomers(
  orgId: string,
  clientId: string,
  segment: LifecycleStageCustomer,
  limit = 100,
): Promise<ClientCustomer[]> {
  return query<ClientCustomer>(
    `select ${CUSTOMER_COLUMNS}
     from public.client_customers cc
     join public.client_customer_metrics m
       on m.customer_id = cc.id
      and m.organization_id = cc.organization_id
      and m.client_id = cc.client_id
     where cc.organization_id = $1
       and cc.client_id = $2
       and m.lifecycle_stage = $3::public.lifecycle_stage_customer
     order by m.monetary desc
     limit $4`,
    [orgId, clientId, segment, limit],
  )
}

// ---------------------------------------------------------------------------
// getCustomerMetrics
// ---------------------------------------------------------------------------

const CUSTOMER_METRIC_COLUMNS = `
  id, organization_id, client_id, customer_id, recency_days, frequency, monetary,
  rfm_recency, rfm_frequency, rfm_monetary, aov, predicted_ltv, lifecycle_stage,
  churn_risk, next_order_estimate, computed_at, created_at
`

export interface GetCustomerMetricsOptions {
  limit?: number
}

/** Tenant-scoped: the latest computed RFM/lifecycle row per customer, highest spend first. */
export async function getCustomerMetrics(
  orgId: string,
  clientId: string,
  opts: GetCustomerMetricsOptions = {},
): Promise<ClientCustomerMetric[]> {
  const params: unknown[] = [orgId, clientId]
  let sql = `select ${CUSTOMER_METRIC_COLUMNS} from public.client_customer_metrics
             where organization_id = $1 and client_id = $2
             order by monetary desc`
  if (opts.limit) {
    params.push(opts.limit)
    sql += ` limit $${params.length}`
  }
  return query<ClientCustomerMetric>(sql, params)
}

// ---------------------------------------------------------------------------
// getCohorts
// ---------------------------------------------------------------------------

const COHORT_COLUMNS = `
  id, organization_id, client_id, cohort_key, period_index, customers, retained,
  revenue, computed_at, created_at
`

/** Tenant-scoped: cohort retention rows (by acquisition month), ordered for charting. */
export async function getCohorts(orgId: string, clientId: string): Promise<ClientCohort[]> {
  return query<ClientCohort>(
    `select ${COHORT_COLUMNS} from public.client_cohorts
     where organization_id = $1 and client_id = $2
     order by cohort_key asc, period_index asc`,
    [orgId, clientId],
  )
}

// ---------------------------------------------------------------------------
// getProductPerformance
// ---------------------------------------------------------------------------

export interface ProductPerformance {
  product_id: string
  title: string
  product_type: string | null
  vendor: string | null
  revenue: number
  units_sold: number
}

export interface GetProductPerformanceOptions {
  limit?: number
}

/**
 * Tenant-scoped: top products by revenue, computed from order line items joined to the
 * catalog snapshot on (client_id, product_external_id = external_id).
 */
export async function getProductPerformance(
  orgId: string,
  clientId: string,
  opts: GetProductPerformanceOptions = {},
): Promise<ProductPerformance[]> {
  return query<ProductPerformance>(
    `select
       p.id as product_id,
       p.title,
       p.product_type,
       p.vendor,
       coalesce(sum(oi.quantity * oi.price), 0)::float8 as revenue,
       coalesce(sum(oi.quantity), 0)::int as units_sold
     from public.client_products p
     left join public.client_order_items oi
       on oi.client_id = p.client_id and oi.product_external_id = p.external_id
     where p.organization_id = $1 and p.client_id = $2
     group by p.id, p.title, p.product_type, p.vendor
     order by revenue desc
     limit $3`,
    [orgId, clientId, opts.limit ?? 20],
  )
}

// ---------------------------------------------------------------------------
// recomputeAnalytics
// ---------------------------------------------------------------------------

/**
 * (Re)computes client_customer_metrics and client_cohorts for one client, from the raw
 * client_customers / client_orders tables. Idempotent: deletes then reinserts this client's
 * rows inside a transaction, so it's safe to call on a schedule or from a script.
 *
 * v1 heuristic, tunable — the RFM thresholds and the lifecycle rule below are a first pass,
 * not a model. See docs/03-data-model.md ("Derived retention analytics").
 */
export async function recomputeAnalytics(orgId: string, clientId: string): Promise<void> {
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('begin')

    // --- client_customer_metrics --------------------------------------------------
    await client.query(
      `delete from public.client_customer_metrics where organization_id = $1 and client_id = $2`,
      [orgId, clientId],
    )
    await client.query(
      `
      with base as (
        select
          c.id as customer_id,
          c.organization_id,
          c.client_id,
          -- recency_days: days since last order; customers who never ordered are treated as
          -- maximally stale so they fall out as 'churned' rather than skew the scoring.
          coalesce(extract(day from now() - c.last_order_at)::int, 99999) as recency_days,
          c.orders_count as frequency,
          c.total_spent as monetary
        from public.client_customers c
        where c.organization_id = $1 and c.client_id = $2
      ),
      scored as (
        select
          base.*,
          case
            when recency_days <= 30 then 5
            when recency_days <= 60 then 4
            when recency_days <= 120 then 3
            when recency_days <= 240 then 2
            else 1
          end as rfm_recency,
          case
            when frequency >= 10 then 5
            when frequency >= 6 then 4
            when frequency >= 3 then 3
            when frequency >= 2 then 2
            else 1
          end as rfm_frequency,
          case
            when monetary >= 1000 then 5
            when monetary >= 500 then 4
            when monetary >= 250 then 3
            when monetary >= 100 then 2
            else 1
          end as rfm_monetary,
          case when frequency > 0 then monetary / nullif(frequency, 0) else null end as aov
        from base
      )
      insert into public.client_customer_metrics
        (organization_id, client_id, customer_id, recency_days, frequency, monetary,
         rfm_recency, rfm_frequency, rfm_monetary, aov, predicted_ltv, lifecycle_stage,
         churn_risk, next_order_estimate, computed_at)
      select
        organization_id, client_id, customer_id, recency_days, frequency, monetary,
        rfm_recency, rfm_frequency, rfm_monetary, aov,
        -- predicted_ltv: v1 placeholder = aov * greatest(frequency, 1), not a real LTV model.
        coalesce(aov, 0) * greatest(frequency, 1) as predicted_ltv,
        -- lifecycle_stage: evaluated in this exact order (spec-mandated).
        (case
           when recency_days > 180 then 'churned'
           when rfm_monetary >= 5 and rfm_frequency >= 4 and recency_days <= 90 then 'vip'
           when recency_days > 90 then 'at_risk'
           when frequency <= 1 then 'new'
           else 'active'
         end)::public.lifecycle_stage_customer as lifecycle_stage,
        -- churn_risk: recency ramp * frequency dampener, clamped to [0, 1].
        greatest(
          0,
          least(
            1,
            least(1.0, recency_days / 180.0) * (1 - least(frequency, 5) / 10.0)
          )
        ) as churn_risk,
        null::date as next_order_estimate, -- v1: no forecasting model yet
        now() as computed_at
      from scored
      `,
      [orgId, clientId],
    )

    // --- client_cohorts -------------------------------------------------------------
    await client.query(
      `delete from public.client_cohorts where organization_id = $1 and client_id = $2`,
      [orgId, clientId],
    )
    await client.query(
      `
      with cohort_customers as (
        select
          id as customer_id,
          organization_id,
          client_id,
          date_trunc('month', first_order_at) as cohort_key
        from public.client_customers
        where organization_id = $1 and client_id = $2 and first_order_at is not null
      ),
      cohort_sizes as (
        select organization_id, client_id, cohort_key, count(*)::int as customers
        from cohort_customers
        group by organization_id, client_id, cohort_key
      ),
      -- period_index 0..12: months since acquisition month, capped at a year. Simplification:
      -- this always emits rows through period 12 even for cohorts too young to have reached
      -- that period yet — those simply show retained = 0 / revenue = 0 (not yet observed,
      -- indistinguishable here from "observed and churned").
      periods as (
        select cs.organization_id, cs.client_id, cs.cohort_key, cs.customers, p.period_index
        from cohort_sizes cs, generate_series(0, 12) as p(period_index)
      ),
      order_activity as (
        select
          cc.client_id,
          cc.cohort_key,
          (extract(year from age(date_trunc('month', o.ordered_at), cc.cohort_key)) * 12
            + extract(month from age(date_trunc('month', o.ordered_at), cc.cohort_key)))::int
            as period_index,
          o.customer_id,
          o.total
        from public.client_orders o
        join cohort_customers cc on cc.customer_id = o.customer_id
        where o.ordered_at >= cc.cohort_key
      ),
      period_agg as (
        select
          client_id,
          cohort_key,
          period_index,
          count(distinct customer_id)::int as retained,
          sum(total) as revenue
        from order_activity
        where period_index between 0 and 12
        group by client_id, cohort_key, period_index
      )
      insert into public.client_cohorts
        (organization_id, client_id, cohort_key, period_index, customers, retained, revenue, computed_at)
      select
        p.organization_id, p.client_id, p.cohort_key, p.period_index, p.customers,
        coalesce(pa.retained, 0), coalesce(pa.revenue, 0), now()
      from periods p
      left join period_agg pa
        on pa.client_id = p.client_id
       and pa.cohort_key = p.cohort_key
       and pa.period_index = p.period_index
      `,
      [orgId, clientId],
    )

    await client.query('commit')
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    client.release()
  }
}
