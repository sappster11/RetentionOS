import Link from 'next/link'
import { notFound } from 'next/navigation'
import { describeTable, getRecordEnriched, getTableBySlug } from '@retentionos/engine'
import { getCurrentOrg } from '@/lib/org'
import { retentionOverview } from '@/lib/retention'

// The per-client Retention section (docs/12 priority 1): server-rendered analytics
// surface over the parked 0004 tables, reached from a Clients record. Read-only.

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export default async function RetentionPage({
  params,
}: {
  params: Promise<{ recordId: string }>
}) {
  const { recordId } = await params
  const org = await getCurrentOrg()
  const clients = await getTableBySlug(org.id, 'clients')
  if (!clients) notFound()
  const record = await getRecordEnriched(org.id, clients.id, recordId)
  if (!record) notFound()

  const { fields } = await describeTable(org.id, clients.id)
  const primary = [...fields].sort((a, b) => a.position - b.position)[0]
  const clientName = String((primary && record.values[primary.id]) || 'Client')

  const o = await retentionOverview(org.id, recordId, clientName)

  const card = (label: string, value: string, sub?: string) => (
    <div
      key={label}
      style={{
        border: '1px solid var(--border, #e2e2e2)',
        borderRadius: 8,
        padding: '14px 16px',
        background: '#fff',
        minWidth: 150,
      }}
    >
      <div style={{ fontSize: 12, color: '#6b6b6b' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, marginTop: 2 }}>{value}</div>
      {sub ? <div style={{ fontSize: 11, color: '#8a8a8a', marginTop: 2 }}>{sub}</div> : null}
    </div>
  )

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '28px 20px', fontSize: 14 }}>
      <div style={{ marginBottom: 18 }}>
        <Link href={`/t/clients?record=${record.id}`} style={{ fontSize: 13, color: '#2b6cb0' }}>
          ← {clientName} (client record)
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '8px 0 2px' }}>
          {clientName} — Retention
        </h1>
        <div style={{ fontSize: 12, color: '#8a8a8a' }}>
          {o.computedAt
            ? `Metrics computed ${new Date(o.computedAt).toLocaleString()}`
            : 'No metrics computed yet'}
        </div>
      </div>

      {!o.available ? (
        <Notice title="Analytics schema not provisioned">
          This database doesn&apos;t have the analytics tables yet — run{' '}
          <code>pnpm --filter @retentionos/db migrate</code> against it.
        </Notice>
      ) : !o.hasData ? (
        <Notice title="No retention data yet">
          This client is provisioned for analytics but has no synced data. Connect their
          Klaviyo/Shopify via the integrations pipeline (or push data through the API — see{' '}
          <code>docs/N8N_INTEGRATION.md</code>), then run the analytics compute job.
        </Notice>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
            {card('Customers', String(o.totals.customers))}
            {card('Revenue (tracked)', fmtMoney(o.totals.revenue))}
            {card('Avg predicted LTV', o.totals.avgLtv != null ? fmtMoney(o.totals.avgLtv) : '—')}
            {card(
              'At-risk customers',
              String(o.totals.atRisk),
              o.totals.avgChurnRisk != null
                ? `avg churn risk ${(o.totals.avgChurnRisk * 100).toFixed(0)}%`
                : undefined,
            )}
          </div>

          <Section title="Lifecycle breakdown">
            {o.lifecycle.map((l) => {
              const pct = o.totals.customers > 0 ? (l.customers / o.totals.customers) * 100 : 0
              return (
                <div key={l.stage} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <div style={{ width: 130, fontSize: 13, color: '#444', textTransform: 'capitalize' }}>
                    {l.stage.replace(/_/g, ' ')}
                  </div>
                  <div style={{ flex: 1, background: '#f0f0f0', borderRadius: 4, height: 16 }}>
                    <div
                      style={{
                        width: `${Math.max(pct, 2)}%`,
                        background: '#7aa7d9',
                        height: '100%',
                        borderRadius: 4,
                      }}
                    />
                  </div>
                  <div style={{ width: 46, fontSize: 12, color: '#666', textAlign: 'right' }}>
                    {l.customers}
                  </div>
                </div>
              )
            })}
          </Section>

          <Section title="Top customers by spend">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#6b6b6b', fontSize: 12 }}>
                  <th style={{ padding: '6px 8px' }}>Customer</th>
                  <th style={{ padding: '6px 8px' }}>Email</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Spend</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Predicted LTV</th>
                </tr>
              </thead>
              <tbody>
                {o.topCustomers.map((c, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #ececec' }}>
                    <td style={{ padding: '6px 8px' }}>{c.name}</td>
                    <td style={{ padding: '6px 8px', color: '#666' }}>{c.email ?? '—'}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmtMoney(c.monetary)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                      {c.ltv != null ? fmtMoney(c.ltv) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Cohort retention (months since first order)">
            <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ color: '#6b6b6b' }}>
                  <th style={{ padding: '4px 10px', textAlign: 'left' }}>Cohort</th>
                  <th style={{ padding: '4px 10px', textAlign: 'right' }}>Size</th>
                  {[0, 1, 2, 3, 4, 5, 6].map((p) => (
                    <th key={p} style={{ padding: '4px 10px', textAlign: 'right' }}>
                      M{p}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {o.cohorts.map((c) => (
                  <tr key={c.cohortKey} style={{ borderTop: '1px solid #ececec' }}>
                    <td style={{ padding: '4px 10px' }}>{c.cohortKey}</td>
                    <td style={{ padding: '4px 10px', textAlign: 'right' }}>{c.customers}</td>
                    {c.periods.map((v, i) => (
                      <td
                        key={i}
                        style={{
                          padding: '4px 10px',
                          textAlign: 'right',
                          background:
                            v != null ? `rgba(122,167,217,${Math.min(v / 100, 1) * 0.55})` : undefined,
                          color: v != null ? '#1a2a3a' : '#bbb',
                        }}
                      >
                        {v != null ? `${v}%` : '·'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 26 }}>
      <h2 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 10px', color: '#333' }}>{title}</h2>
      {children}
    </div>
  )
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        border: '1px solid #e2d9b8',
        background: '#fdf9ec',
        borderRadius: 8,
        padding: '14px 16px',
        fontSize: 13,
        color: '#5c5133',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
      {children}
    </div>
  )
}
