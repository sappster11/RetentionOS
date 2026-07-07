import { notFound } from 'next/navigation'
import { getCurrentOrg } from '@/lib/org'
import { portalData } from '@/lib/portal'
import { PortalApprovals } from './PortalApprovals'

// The client portal (docs/14): capability-link page showing THIS client's documents and
// pending approvals. Read-only except the approval actions. Bare chrome, client-friendly.

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
    <div style={{ minHeight: '100vh', background: '#f7f7f8' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 20px 64px', fontSize: 14 }}>
        <div
          style={{
            fontSize: 11.5,
            fontWeight: 600,
            letterSpacing: 1.2,
            textTransform: 'uppercase',
            color: '#8a8a8a',
          }}
        >
          Client portal
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 750, margin: '4px 0 28px' }}>{data.clientName}</h1>

        <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 10px' }}>
          Awaiting your approval {data.approvals.length > 0 ? `(${data.approvals.length})` : ''}
        </h2>
        {data.approvals.length === 0 ? (
          <div style={{ color: '#8a8a8a', fontSize: 13, marginBottom: 28 }}>
            Nothing waiting on you right now. 🎉
          </div>
        ) : (
          <PortalApprovals token={token} approvals={data.approvals} />
        )}

        <h2 style={{ fontSize: 15, fontWeight: 700, margin: '30px 0 10px' }}>Your documents</h2>
        {data.documents.length === 0 ? (
          <div style={{ color: '#8a8a8a', fontSize: 13 }}>No documents shared yet.</div>
        ) : (
          <div style={{ border: '1px solid #e4e4e6', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
            {data.documents.map((d, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '11px 14px',
                  borderTop: i > 0 ? '1px solid #efeff1' : 'none',
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600 }}>{d.type ?? 'Document'}</span>
                {d.year ? <span style={{ fontSize: 12, color: '#8a8a8a' }}>{d.year}</span> : null}
                <span style={{ flex: 1 }} />
                {d.url ? (
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 13, fontWeight: 600, color: '#2b6cb0', textDecoration: 'none' }}
                  >
                    Open
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 40, fontSize: 11.5, color: '#b0b0b3' }}>
          Powered by Roam · questions? just reply in Slack
        </div>
      </div>
    </div>
  )
}
