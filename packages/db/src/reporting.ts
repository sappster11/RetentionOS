// Reporting data foundation (Phase 5): client health scoring, time-series metric snapshots,
// and the tenant-scoped reads that back the reporting/dashboard surface — see
// migration 0007_reporting.sql for the metric_snapshots table this writes into.
//
// Health scoring reuses getRetentionOverview (src/clientData.ts) for the lifecycle-stage
// distribution that feeds the formula below, so the "customers with metrics" count and the
// per-stage shares stay consistent with the retention-overview reads elsewhere in the app.

import { getClient, listClients, updateClient } from './clients'
import { getRetentionOverview } from './clientData'
import { logActivity } from './activities'
import { getPool, query, queryOne } from './pool'
import type { PoolClient } from 'pg'
import type {
  ClientHealth,
  ClientStatus,
  HealthDrivers,
  LifecycleStageCustomer,
  MetricSnapshot,
} from './types'

// ---------------------------------------------------------------------------
// computeHealthScores
// ---------------------------------------------------------------------------

/**
 * Computes health-score inputs for one client: n = count of customers with metrics for the
 * client, and (if n > 0) the lifecycle-share drivers + capped overdue-task count + score.
 *
 * v1 heuristic, tunable — not a model, a first pass. Formula:
 *   n = count of customers with metrics for the client (sum of lifecycleCounts)
 *   activeShare = (active + vip) / n
 *   churnShare  = churned / n
 *   riskShare   = at_risk / n
 *   overdue     = count of open tasks past due for the client, capped at 5
 *   score = round(clamp(50 + 45*activeShare − 50*churnShare − 20*riskShare − 3*overdue, 0, 100))
 * If n = 0 there isn't enough data to score the client — drivers/score come back null and the
 * caller leaves the client's stored health_score unchanged.
 */
async function computeClientHealthDrivers(
  orgId: string,
  clientId: string,
  lifecycleCounts: Record<LifecycleStageCustomer, number>,
): Promise<{ n: number; drivers: HealthDrivers | null; score: number | null }> {
  const n = Object.values(lifecycleCounts).reduce((sum, count) => sum + count, 0)
  if (n === 0) return { n, drivers: null, score: null }

  const activeShare = (lifecycleCounts.active + lifecycleCounts.vip) / n
  const churnShare = lifecycleCounts.churned / n
  const riskShare = lifecycleCounts.at_risk / n

  const overdueRow = await queryOne<{ overdue: number }>(
    `select count(*)::int as overdue from public.tasks
     where organization_id = $1 and client_id = $2
       and due_on < current_date and status <> 'done'`,
    [orgId, clientId],
  )
  const overdue = Math.min(overdueRow?.overdue ?? 0, 5)

  const raw = 50 + 45 * activeShare - 50 * churnShare - 20 * riskShare - 3 * overdue
  const score = Math.round(Math.min(100, Math.max(0, raw)))

  return { n, drivers: { activeShare, churnShare, riskShare, overdue }, score }
}

/**
 * Recomputes and persists health_score for every non-archived client in the org, from its
 * client_customer_metrics lifecycle distribution + overdue tasks (see
 * computeClientHealthDrivers for the exact formula). Logs a `client.health_changed` activity
 * whenever a client's score actually changes. Returns the per-client result either way.
 */
export async function computeHealthScores(orgId: string): Promise<ClientHealth[]> {
  const clients = await listClients(orgId)
  const results: ClientHealth[] = []

  for (const client of clients) {
    const overview = await getRetentionOverview(orgId, client.id)
    const { drivers, score } = await computeClientHealthDrivers(
      orgId,
      client.id,
      overview.lifecycleCounts,
    )

    if (score === null) {
      // n = 0: not enough data to score this client — leave the stored health_score as-is.
      results.push({ client_id: client.id, name: client.name, health_score: null, drivers: null })
      continue
    }

    await updateClient(orgId, client.id, { health_score: score })

    if (client.health_score !== score) {
      await logActivity(orgId, {
        client_id: client.id,
        actor_type: 'system',
        verb: 'client.health_changed',
        summary: `Health score is now ${score}`,
        data: { score, drivers },
      })
    }

    results.push({ client_id: client.id, name: client.name, health_score: score, drivers })
  }

  return results
}

// ---------------------------------------------------------------------------
// clientHealth
// ---------------------------------------------------------------------------

export interface ClientHealthDetail {
  health_score: number | null
  drivers: HealthDrivers | null
  lifecycle_counts: Record<LifecycleStageCustomer, number>
}

/** Tenant-scoped: the client's current stored health_score plus a fresh explanation of what's
 *  currently driving it (recomputed live from lifecycle counts — not read back from a snapshot). */
export async function clientHealth(
  orgId: string,
  clientId: string,
): Promise<ClientHealthDetail | null> {
  const client = await getClient(orgId, clientId)
  if (!client) return null

  const overview = await getRetentionOverview(orgId, clientId)
  const { drivers } = await computeClientHealthDrivers(orgId, clientId, overview.lifecycleCounts)

  return {
    health_score: client.health_score,
    drivers,
    lifecycle_counts: overview.lifecycleCounts,
  }
}

// ---------------------------------------------------------------------------
// captureSnapshots
// ---------------------------------------------------------------------------

const METRIC_SNAPSHOT_COLUMNS = `
  id, organization_id, client_id, metric_key, value, period, captured_at, metadata, created_at
`

interface ClientSnapshotRow {
  client_id: string
  status: ClientStatus
  health_score: number | null
  customers: number
  revenue: string
  at_risk_customers: number
}

async function insertSnapshot(
  pgClient: PoolClient,
  orgId: string,
  clientId: string | null,
  metricKey: string,
  value: number,
  metadata?: Record<string, unknown>,
): Promise<MetricSnapshot> {
  const result = await pgClient.query(
    `insert into public.metric_snapshots (organization_id, client_id, metric_key, value, metadata)
     values ($1, $2, $3, $4, coalesce($5::jsonb, '{}'::jsonb))
     returning ${METRIC_SNAPSHOT_COLUMNS}`,
    [orgId, clientId, metricKey, value, metadata ? JSON.stringify(metadata) : null],
  )
  return result.rows[0] as MetricSnapshot
}

/**
 * Inserts a fresh 'all'-period metric_snapshots row for each tracked metric: per-client
 * health_score / customers / revenue / at_risk_customers, and org-level portfolio_revenue /
 * avg_health / at_risk_clients / active_clients. This is a time series, not a point-in-time
 * upsert — every call just appends new rows, so it's safe to run on a schedule.
 */
export async function captureSnapshots(orgId: string): Promise<MetricSnapshot[]> {
  const pool = getPool()
  const pgClient = await pool.connect()
  const inserted: MetricSnapshot[] = []

  try {
    await pgClient.query('begin')

    const statsResult = await pgClient.query(
      `with client_customers_agg as (
         select client_id,
           count(*)::int as customers,
           coalesce(sum(total_spent), 0)::numeric as revenue
         from public.client_customers
         where organization_id = $1
         group by client_id
       ),
       at_risk_agg as (
         select client_id,
           count(*) filter (where lifecycle_stage = 'at_risk')::int as at_risk_customers
         from public.client_customer_metrics
         where organization_id = $1
         group by client_id
       )
       select
         c.id as client_id,
         c.status,
         c.health_score,
         coalesce(cc.customers, 0)::int as customers,
         coalesce(cc.revenue, 0)::numeric as revenue,
         coalesce(ar.at_risk_customers, 0)::int as at_risk_customers
       from public.clients c
       left join client_customers_agg cc on cc.client_id = c.id
       left join at_risk_agg ar on ar.client_id = c.id
       where c.organization_id = $1 and c.archived_at is null`,
      [orgId],
    )
    const rows = statsResult.rows as ClientSnapshotRow[]

    for (const row of rows) {
      if (row.health_score !== null) {
        inserted.push(
          await insertSnapshot(pgClient, orgId, row.client_id, 'health_score', row.health_score),
        )
      }
      inserted.push(await insertSnapshot(pgClient, orgId, row.client_id, 'customers', row.customers))
      inserted.push(
        await insertSnapshot(pgClient, orgId, row.client_id, 'revenue', Number(row.revenue)),
      )
      inserted.push(
        await insertSnapshot(
          pgClient,
          orgId,
          row.client_id,
          'at_risk_customers',
          row.at_risk_customers,
        ),
      )
    }

    const activeClients = rows.filter((r) => r.status === 'active').length
    const atRiskClients = rows.filter(
      (r) => r.status === 'at_risk' || (r.health_score !== null && r.health_score < 40),
    ).length
    const portfolioRevenue = rows.reduce((sum, r) => sum + Number(r.revenue), 0)
    const healthValues = rows
      .map((r) => r.health_score)
      .filter((h): h is number => h !== null)
    const avgHealth =
      healthValues.length === 0
        ? 0
        : healthValues.reduce((sum, h) => sum + h, 0) / healthValues.length

    inserted.push(await insertSnapshot(pgClient, orgId, null, 'portfolio_revenue', portfolioRevenue))
    inserted.push(await insertSnapshot(pgClient, orgId, null, 'avg_health', avgHealth))
    inserted.push(await insertSnapshot(pgClient, orgId, null, 'at_risk_clients', atRiskClients))
    inserted.push(await insertSnapshot(pgClient, orgId, null, 'active_clients', activeClients))

    await pgClient.query('commit')
  } catch (err) {
    await pgClient.query('rollback')
    throw err
  } finally {
    pgClient.release()
  }

  return inserted
}

// ---------------------------------------------------------------------------
// portfolioOverview
// ---------------------------------------------------------------------------

export interface PortfolioOverview {
  clients: number
  total_customers: number
  total_revenue: number
  avg_health: number
  at_risk_clients: number
  campaigns: number
}

/** Org-wide rollup across every non-archived client: customers, revenue, health, campaigns. */
export async function portfolioOverview(orgId: string): Promise<PortfolioOverview> {
  const row = await queryOne<{
    clients: number
    total_customers: number
    total_revenue: number
    avg_health: number
    at_risk_clients: number
    campaigns: number
  }>(
    `with client_totals as (
       select
         c.id,
         c.status,
         c.health_score,
         coalesce(cc.customers, 0) as customers,
         coalesce(cc.revenue, 0) as revenue
       from public.clients c
       left join (
         select client_id,
           count(*)::int as customers,
           coalesce(sum(total_spent), 0)::numeric as revenue
         from public.client_customers
         where organization_id = $1
         group by client_id
       ) cc on cc.client_id = c.id
       where c.organization_id = $1 and c.archived_at is null
     )
     select
       count(*)::int as clients,
       coalesce(sum(customers), 0)::int as total_customers,
       coalesce(sum(revenue), 0)::float8 as total_revenue,
       coalesce(avg(health_score), 0)::float8 as avg_health,
       count(*) filter (where status = 'at_risk' or health_score < 40)::int as at_risk_clients,
       (select count(*)::int from public.campaigns where organization_id = $1) as campaigns
     from client_totals`,
    [orgId],
  )

  return (
    row ?? {
      clients: 0,
      total_customers: 0,
      total_revenue: 0,
      avg_health: 0,
      at_risk_clients: 0,
      campaigns: 0,
    }
  )
}

// ---------------------------------------------------------------------------
// atRiskClients
// ---------------------------------------------------------------------------

export interface AtRiskClient {
  client_id: string
  name: string
  status: ClientStatus
  health_score: number | null
  at_risk_customers: number
  churn_customers: number
  reason: string
}

function buildAtRiskReason(row: Omit<AtRiskClient, 'reason'>): string {
  const reasons: string[] = []
  if (row.status === 'at_risk') reasons.push('status is at_risk')
  if (row.health_score !== null && row.health_score < 40) {
    reasons.push(`health score is ${row.health_score}`)
  }
  if (row.at_risk_customers > 0) reasons.push(`${row.at_risk_customers} at-risk customers`)
  if (row.churn_customers > 0) reasons.push(`${row.churn_customers} churned customers`)
  return reasons.length > 0 ? reasons.join('; ') : 'flagged for review'
}

/** Clients flagged as at-risk: either the CRM status says so, or the health score has dropped
 *  below 40. Each row carries a short human-readable reason built from its own drivers. */
export async function atRiskClients(orgId: string): Promise<AtRiskClient[]> {
  const rows = await query<Omit<AtRiskClient, 'reason'>>(
    `with metrics_agg as (
       select client_id,
         count(*) filter (where lifecycle_stage = 'at_risk')::int as at_risk_customers,
         count(*) filter (where lifecycle_stage = 'churned')::int as churn_customers
       from public.client_customer_metrics
       where organization_id = $1
       group by client_id
     )
     select
       c.id as client_id,
       c.name,
       c.status,
       c.health_score,
       coalesce(m.at_risk_customers, 0)::int as at_risk_customers,
       coalesce(m.churn_customers, 0)::int as churn_customers
     from public.clients c
     left join metrics_agg m on m.client_id = c.id
     where c.organization_id = $1
       and c.archived_at is null
       and (c.status = 'at_risk' or c.health_score < 40)
     order by c.health_score asc nulls last, c.name asc`,
    [orgId],
  )

  return rows.map((row) => ({ ...row, reason: buildAtRiskReason(row) }))
}

// ---------------------------------------------------------------------------
// retentionMetricsByClient
// ---------------------------------------------------------------------------

export interface ClientRetentionMetrics {
  client_id: string
  name: string
  customers: number
  revenue: number
  active_pct: number
  at_risk_pct: number
  churn_pct: number
  health_score: number | null
}

/** Per-client retention snapshot: customer count, revenue, lifecycle-share percentages and
 *  the current health score — the row shape a "retention by client" table/report wants. */
export async function retentionMetricsByClient(orgId: string): Promise<ClientRetentionMetrics[]> {
  return query<ClientRetentionMetrics>(
    `with customers_agg as (
       select client_id,
         count(*)::int as customers,
         coalesce(sum(total_spent), 0)::numeric as revenue
       from public.client_customers
       where organization_id = $1
       group by client_id
     ),
     lifecycle_agg as (
       select client_id,
         count(*) filter (where lifecycle_stage in ('active', 'vip'))::int as active_n,
         count(*) filter (where lifecycle_stage = 'at_risk')::int as at_risk_n,
         count(*) filter (where lifecycle_stage = 'churned')::int as churn_n,
         count(*)::int as total_n
       from public.client_customer_metrics
       where organization_id = $1
       group by client_id
     )
     select
       c.id as client_id,
       c.name,
       c.health_score,
       coalesce(cu.customers, 0)::int as customers,
       coalesce(cu.revenue, 0)::float8 as revenue,
       case when coalesce(la.total_n, 0) = 0 then 0
            else round(100.0 * la.active_n / la.total_n, 1) end::float8 as active_pct,
       case when coalesce(la.total_n, 0) = 0 then 0
            else round(100.0 * la.at_risk_n / la.total_n, 1) end::float8 as at_risk_pct,
       case when coalesce(la.total_n, 0) = 0 then 0
            else round(100.0 * la.churn_n / la.total_n, 1) end::float8 as churn_pct
     from public.clients c
     left join customers_agg cu on cu.client_id = c.id
     left join lifecycle_agg la on la.client_id = c.id
     where c.organization_id = $1 and c.archived_at is null
     order by c.name asc`,
    [orgId],
  )
}
