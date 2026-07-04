import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  getClient,
  getRetentionOverview,
  listSegmentCustomers,
  getCustomerMetrics,
  getCohorts,
  getProductPerformance,
  type ClientCustomer,
  type ClientCustomerMetric,
  type LifecycleStageCustomer,
} from '@retentionos/db'
import { getCurrentOrg } from '@/lib/org'
import { Card, linkStyle } from '../../../_components/ui'

const LIFECYCLE_STAGES: readonly LifecycleStageCustomer[] = [
  'new',
  'active',
  'at_risk',
  'churned',
  'won_back',
  'vip',
]

const LIFECYCLE_COLORS: Record<LifecycleStageCustomer, string> = {
  new: '#5b6472',
  active: '#2f6fdb',
  at_risk: '#d98a3d',
  churned: '#d9524a',
  won_back: '#3dbf7a',
  vip: '#a855f7',
}

const SEGMENTS: readonly LifecycleStageCustomer[] = ['at_risk', 'vip']

function num(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(0)}%`
}

function customerDisplayName(customer: ClientCustomer): string {
  const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim()
  return name || customer.email || '(unnamed customer)'
}

function formatCohortMonth(cohortKey: string): string {
  const date = new Date(cohortKey)
  if (Number.isNaN(date.getTime())) return cohortKey
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' })
}

export default async function ClientRetentionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const org = await getCurrentOrg()
  const client = await getClient(org.id, id)
  if (!client) notFound()

  const [overview, atRiskCustomers, vipCustomers, customerMetrics, cohorts, products] =
    await Promise.all([
      getRetentionOverview(org.id, client.id),
      listSegmentCustomers(org.id, client.id, 'at_risk'),
      listSegmentCustomers(org.id, client.id, 'vip'),
      getCustomerMetrics(org.id, client.id),
      getCohorts(org.id, client.id),
      getProductPerformance(org.id, client.id, { limit: 10 }),
    ])

  const segmentCustomers: Record<LifecycleStageCustomer, ClientCustomer[]> = {
    new: [],
    active: [],
    at_risk: atRiskCustomers,
    churned: [],
    won_back: [],
    vip: vipCustomers,
  }

  const metricsByCustomerId = new Map<string, ClientCustomerMetric>()
  for (const metric of customerMetrics) {
    metricsByCustomerId.set(metric.customer_id, metric)
  }

  const maxLifecycleCount = Math.max(1, ...LIFECYCLE_STAGES.map((s) => overview.lifecycleCounts[s]))

  // cohort_key (month) x period_index (months since acquisition) grid
  const cohortKeys = Array.from(new Set(cohorts.map((c) => c.cohort_key))).sort()
  const periodIndices = Array.from(new Set(cohorts.map((c) => c.period_index))).sort((a, b) => a - b)
  const cohortCellByKey = new Map<string, (typeof cohorts)[number]>()
  for (const row of cohorts) {
    cohortCellByKey.set(`${row.cohort_key}:${row.period_index}`, row)
  }

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: '3rem 1.5rem' }}>
      <p style={{ marginTop: 0 }}>
        <Link href={`/clients/${client.id}`} style={linkStyle}>
          ← {client.name}
        </Link>
      </p>

      <h1 style={{ fontSize: '1.6rem', margin: 0 }}>{client.name}</h1>
      <p style={{ opacity: 0.6, marginTop: '0.25rem' }}>Retention</p>

      <Card title="Overview">
        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '0.75rem', opacity: 0.6 }}>Total customers</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 600 }}>{overview.totalCustomers}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', opacity: 0.6 }}>Total revenue</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 600 }}>
              {formatCurrency(num(overview.totalRevenue))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', opacity: 0.6 }}>Avg AOV</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 600 }}>
              {formatCurrency(num(overview.avgAov))}
            </div>
          </div>
        </div>
        <p style={{ opacity: 0.5, fontSize: '0.75rem', marginBottom: 0, marginTop: '1rem' }}>
          Based on synced commerce data.
        </p>
      </Card>

      <Card title="Lifecycle distribution">
        {overview.totalCustomers === 0 ? (
          <p style={{ opacity: 0.6 }}>No customer data yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {LIFECYCLE_STAGES.map((stage) => {
              const count = overview.lifecycleCounts[stage]
              const widthPct = (count / maxLifecycleCount) * 100
              return (
                <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span
                    style={{
                      width: 90,
                      flexShrink: 0,
                      fontSize: '0.8rem',
                      textTransform: 'capitalize',
                      opacity: 0.75,
                    }}
                  >
                    {stage.replace('_', ' ')}
                  </span>
                  <div style={{ flex: 1, background: '#1c1e22', borderRadius: 4, height: 18 }}>
                    <div
                      style={{
                        width: `${widthPct}%`,
                        minWidth: count > 0 ? 4 : 0,
                        height: '100%',
                        borderRadius: 4,
                        background: LIFECYCLE_COLORS[stage],
                      }}
                    />
                  </div>
                  <span style={{ width: 28, textAlign: 'right', fontSize: '0.8rem', opacity: 0.75 }}>
                    {count}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {SEGMENTS.map((segment) => {
        const customers = segmentCustomers[segment]
        return (
          <Card
            key={segment}
            title={`${segment === 'at_risk' ? 'At-risk' : 'VIP'} customers (${customers.length})`}
          >
            {customers.length === 0 ? (
              <p style={{ opacity: 0.6 }}>No customers in this segment.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', fontSize: '0.75rem', opacity: 0.6 }}>
                    <th style={{ padding: '0.4rem 0.5rem' }}>Customer</th>
                    <th style={{ padding: '0.4rem 0.5rem' }}>Recency (days)</th>
                    <th style={{ padding: '0.4rem 0.5rem' }}>Frequency</th>
                    <th style={{ padding: '0.4rem 0.5rem' }}>Monetary</th>
                    <th style={{ padding: '0.4rem 0.5rem' }}>Churn risk</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((customer) => {
                    const metric = metricsByCustomerId.get(customer.id)
                    return (
                      <tr key={customer.id} style={{ borderTop: '1px solid #24262b' }}>
                        <td style={{ padding: '0.5rem' }}>
                          <div>{customerDisplayName(customer)}</div>
                          {customer.email ? (
                            <div style={{ opacity: 0.5, fontSize: '0.8rem' }}>{customer.email}</div>
                          ) : null}
                        </td>
                        <td style={{ padding: '0.5rem' }}>{metric?.recency_days ?? '—'}</td>
                        <td style={{ padding: '0.5rem' }}>{metric?.frequency ?? '—'}</td>
                        <td style={{ padding: '0.5rem' }}>
                          {metric ? formatCurrency(num(metric.monetary)) : '—'}
                        </td>
                        <td style={{ padding: '0.5rem' }}>
                          {metric ? formatPercent(num(metric.churn_risk)) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </Card>
        )
      })}

      <Card title="Cohort retention">
        {cohortKeys.length === 0 ? (
          <p style={{ opacity: 0.6 }}>No cohort data yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
              <thead>
                <tr style={{ textAlign: 'left', fontSize: '0.75rem', opacity: 0.6 }}>
                  <th style={{ padding: '0.4rem 0.6rem', whiteSpace: 'nowrap' }}>Cohort</th>
                  {periodIndices.map((period) => (
                    <th key={period} style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>
                      M{period}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cohortKeys.map((cohortKey) => (
                  <tr key={cohortKey} style={{ borderTop: '1px solid #24262b' }}>
                    <td style={{ padding: '0.4rem 0.6rem', whiteSpace: 'nowrap' }}>
                      {formatCohortMonth(cohortKey)}
                    </td>
                    {periodIndices.map((period) => {
                      const cell = cohortCellByKey.get(`${cohortKey}:${period}`)
                      if (!cell || cell.customers === 0) {
                        return (
                          <td
                            key={period}
                            style={{ padding: '0.4rem 0.6rem', textAlign: 'right', opacity: 0.35 }}
                          >
                            —
                          </td>
                        )
                      }
                      const pct = (cell.retained / cell.customers) * 100
                      return (
                        <td key={period} style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>
                          <div>{Number.isFinite(pct) ? `${pct.toFixed(0)}%` : '—'}</div>
                          <div style={{ opacity: 0.5, fontSize: '0.7rem' }}>
                            {cell.retained}/{cell.customers}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Top products">
        {products.length === 0 ? (
          <p style={{ opacity: 0.6 }}>No product data yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', fontSize: '0.75rem', opacity: 0.6 }}>
                <th style={{ padding: '0.4rem 0.5rem' }}>Product</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Units sold</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.product_id} style={{ borderTop: '1px solid #24262b' }}>
                  <td style={{ padding: '0.5rem' }}>{product.title}</td>
                  <td style={{ padding: '0.5rem' }}>{num(product.units_sold)}</td>
                  <td style={{ padding: '0.5rem' }}>{formatCurrency(num(product.revenue))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </main>
  )
}
