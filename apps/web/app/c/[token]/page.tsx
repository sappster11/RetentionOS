import { notFound } from 'next/navigation'
import { getCurrentOrg } from '@/lib/org'
import { portalData } from '@/lib/portal'
import { PortalApprovals } from './PortalApprovals'

// The client portal (docs/14): capability-link page showing THIS client's documents and
// pending approvals. Read-only except the approval actions. This is the highest-stakes
// brand surface — clients see it — so it leads with the roam plate header (plates stay
// dark in both worlds) over the paper body.

export const dynamic = 'force-dynamic'

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  let data = null
  try {
    const org = await getCurrentOrg()
    data = await portalData(org.id, token)
  } catch (err) {
    console.error('[portal] failed to load', err)
    data = null
  }
  if (!data) notFound()

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-subtle)' }}>
      {/* Ink plate header */}
      <div data-plate>
        <div
          style={{
            maxWidth: 720,
            margin: '0 auto',
            padding: '26px 20px 30px',
            display: 'flex',
            flexDirection: 'column',
            gap: 22,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <span className="wordmark" style={{ fontSize: 22 }}>
              roam<sup>®</sup>
            </span>
            <span className="eyebrow" style={{ color: 'var(--text-muted)', fontSize: 10.5 }}>
              Client portal
            </span>
          </div>
          <h1
            style={{
              fontFamily: 'var(--serif)',
              fontSize: 30,
              fontWeight: 400,
              letterSpacing: '-0.01em',
              margin: 0,
            }}
          >
            {data.clientName}
          </h1>
        </div>
      </div>

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '30px 20px 64px', fontSize: 14 }}>
        <h2 style={{ fontFamily: 'var(--serif)', fontSize: 19, fontWeight: 400, margin: '0 0 12px' }}>
          Awaiting your approval {data.approvals.length > 0 ? `(${data.approvals.length})` : ''}
        </h2>
        {data.approvals.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 28 }}>
            Nothing waiting on you right now.
          </div>
        ) : (
          <PortalApprovals token={token} approvals={data.approvals} />
        )}

        <h2 style={{ fontFamily: 'var(--serif)', fontSize: 19, fontWeight: 400, margin: '32px 0 12px' }}>
          Your documents
        </h2>
        {data.documents.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No documents shared yet.</div>
        ) : (
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              overflow: 'hidden',
              background: 'var(--bg)',
            }}
          >
            {data.documents.map((d, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '11px 14px',
                  borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600 }}>{d.type ?? 'Document'}</span>
                {d.year ? (
                  <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--text-muted)' }}>
                    {d.year}
                  </span>
                ) : null}
                <span style={{ flex: 1 }} />
                {d.url ? (
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', textDecoration: 'none' }}
                  >
                    Open
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 40, fontSize: 12, color: 'var(--text-faint)' }}>
          Powered by <span className="wordmark" style={{ fontSize: 13, color: 'var(--text-muted)' }}>roam</span>
          {' '}· questions? just reply in Slack
        </div>
      </div>
    </div>
  )
}
