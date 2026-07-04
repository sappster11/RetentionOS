import Link from 'next/link'
import { portfolioOverview, atRiskClients, retentionMetricsByClient } from '@retentionos/db'
import { getCurrentOrg } from '@/lib/org'
import { Card, StatusBadge, HealthPill, healthColor, linkStyle } from '../_components/ui'

export const dynamic = 'force-dynamic'

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
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return `${value.toFixed(1)}%`
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: '0.75rem', opacity: 0.6 }}>{label}</div>
      <div style={{ fontSize: '1.4rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
    </div>
  )
}

export default async function DashboardPage() {
  const org = await getCurrentOrg()
  const [overview, atRisk, retentionByClient] = await Promise.all([
    portfolioOverview(org.id),
    atRiskClients(org.id),
    retentionMetricsByClient(org.id),
  ])

  const avgHealth = Math.round(num(overview.avg_health))

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: '3rem 1.5rem' }}>
      <p style={{ marginTop: 0 }}>
        <Link href="/clients" style={linkStyle}>
          ← All clients
        </Link>
      </p>

      <h1 style={{ fontSize: '1.6rem', margin: 0 }}>Portfolio</h1>
      <p style={{ opacity: 0.6, marginTop: '0.25rem' }}>{org.name}</p>

      <Card>
        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
          <StatTile label="Clients" value={String(num(overview.clients))} />
          <StatTile label="Customers" value={num(overview.total_customers).toLocaleString('en-US')} />
          <StatTile label="Total revenue" value={formatCurrency(num(overview.total_revenue))} />
          <div>
            <div style={{ fontSize: '0.75rem', opacity: 0.6 }}>Avg health</div>
            <div
              style={{
                fontSize: '1.4rem',
                fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
                color: healthColor(avgHealth),
              }}
            >
              {avgHealth}
            </div>
          </div>
          <StatTile label="At-risk clients" value={String(num(overview.at_risk_clients))} />
          <StatTile label="Campaigns" value={String(num(overview.campaigns))} />
        </div>
      </Card>

      <Card title={`At-risk clients (${atRisk.length})`}>
        {atRisk.length === 0 ? (
          <p style={{ opacity: 0.6 }}>No clients are currently flagged as at-risk.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {atRisk.map((client) => (
              <li
                key={client.client_id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  flexWrap: 'wrap',
                  padding: '0.6rem 0',
                  borderBottom: '1px solid #24262b',
                }}
              >
                <Link href={`/clients/${client.client_id}`} style={{ ...linkStyle, fontWeight: 600 }}>
                  {client.name}
                </Link>
                <StatusBadge status={client.status} />
                <HealthPill score={client.health_score} />
                <span style={{ opacity: 0.6, fontSize: '0.85rem' }}>{client.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Retention by client">
        {retentionByClient.length === 0 ? (
          <p style={{ opacity: 0.6 }}>No client data yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr style={{ textAlign: 'left', fontSize: '0.75rem', opacity: 0.6 }}>
                  <th style={{ padding: '0.4rem 0.5rem' }}>Client</th>
                  <th style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>Customers</th>
                  <th style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>Revenue</th>
                  <th style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>Active %</th>
                  <th style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>At-risk %</th>
                  <th style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>Churn %</th>
                  <th style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>Health</th>
                </tr>
              </thead>
              <tbody>
                {retentionByClient.map((row) => (
                  <tr key={row.client_id} style={{ borderTop: '1px solid #24262b' }}>
                    <td style={{ padding: '0.5rem' }}>
                      <Link href={`/clients/${row.client_id}`} style={linkStyle}>
                        {row.name}
                      </Link>
                    </td>
                    <td
                      style={{
                        padding: '0.5rem',
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {num(row.customers).toLocaleString('en-US')}
                    </td>
                    <td
                      style={{
                        padding: '0.5rem',
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {formatCurrency(num(row.revenue))}
                    </td>
                    <td
                      style={{
                        padding: '0.5rem',
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {formatPercent(num(row.active_pct))}
                    </td>
                    <td
                      style={{
                        padding: '0.5rem',
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {formatPercent(num(row.at_risk_pct))}
                    </td>
                    <td
                      style={{
                        padding: '0.5rem',
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {formatPercent(num(row.churn_pct))}
                    </td>
                    <td style={{ padding: '0.5rem', textAlign: 'right' }}>
                      <HealthPill score={row.health_score} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </main>
  )
}
