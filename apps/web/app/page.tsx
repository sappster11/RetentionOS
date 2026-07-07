import Link from 'next/link'
import { listBases, listTables } from '@retentionos/engine'
import { getCurrentOrg } from '@/lib/org'
import { dashboardStats } from '@/lib/dashboard'

// Home dashboard — kicker/title hierarchy, live stat cards, quick-launch tiles, and a
// workspace directory. Every stat degrades to "—" when its tables aren't seeded yet.

export const dynamic = 'force-dynamic'

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export default async function Home() {
  let org: { id: string; name: string } | null = null
  let bases: Array<{ id: string; name: string; icon: string | null }> = []
  let tables: Array<{ id: string; name: string; slug: string; icon: string | null; base_id: string | null }> = []
  try {
    org = await getCurrentOrg()
    ;[bases, tables] = await Promise.all([listBases(org.id), listTables(org.id)])
  } catch {
    // fresh install with no org/db — render the empty state below
  }

  if (!org || tables.length === 0) {
    return (
      <div style={{ padding: 48, maxWidth: 520 }}>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>Welcome to RetentionOS</h1>
        <p style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Click <strong>+ New table</strong> in the left sidebar to create your first
          table — or run the seeds to install the Sales CRM, Client Hub, and Content
          Studio.
        </p>
      </div>
    )
  }

  const stats = await dashboardStats(org.id)
  const bySlug = (slug: string) => tables.find((t) => t.slug === slug)

  const quickLaunch = [
    { slug: 'leads', title: 'Pipeline', desc: 'Leads, stages, forecast', icon: '🎯' },
    { slug: 'clients', title: 'Clients', desc: 'The book of business', icon: '🏢' },
    { slug: 'send-briefs', title: 'Send Briefs', desc: 'Concept the month', icon: '📋' },
    { slug: 'copy-drafts', title: 'Copy Drafts', desc: 'Creative pipeline', icon: '📝' },
    { slug: 'monthly-strategies', title: 'Strategies', desc: 'The monthly recap', icon: '🧭' },
    { slug: 'brand-voice', title: 'Brand Voice', desc: 'How each brand sounds', icon: '🗣️' },
  ].filter((q) => bySlug(q.slug))

  // Evidence lines are moss; a line that demands attention goes ember (brand color roles).
  const statCards: Array<{ label: string; value: string; sub?: string; tone?: 'attention' }> = [
    {
      label: 'Open pipeline',
      value: stats.openPipeline ? String(stats.openPipeline.count) : '—',
      sub: stats.openPipeline ? `${money(stats.openPipeline.weighted)} weighted` : 'seed the Sales CRM',
    },
    {
      label: 'Overdue follow-ups',
      value: stats.overdueFollowUps != null ? String(stats.overdueFollowUps) : '—',
      sub: stats.overdueFollowUps ? 'work these first' : undefined,
      tone: 'attention',
    },
    {
      label: 'Active clients',
      value: stats.activeClients != null ? String(stats.activeClients) : '—',
    },
    {
      label: 'Copy in review',
      value: stats.draftsInReview != null ? String(stats.draftsInReview) : '—',
      sub: 'Content Studio',
    },
  ]

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ maxWidth: 1040, margin: '0 auto', padding: '30px 28px 48px' }}>
        {/* Kicker + title — the house hierarchy: ember eyebrow over a Newsreader title. */}
        <div className="eyebrow" style={{ color: 'var(--accent)' }}>
          {org.name}
        </div>
        <h1
          style={{
            fontFamily: 'var(--serif)',
            fontSize: 31,
            fontWeight: 400,
            letterSpacing: '-0.01em',
            margin: '6px 0 26px',
          }}
        >
          Dashboard
        </h1>

        {/* Stat cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 14,
            marginBottom: 34,
          }}
        >
          {statCards.map((c) => (
            <div
              key={c.label}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: '16px 18px',
                background: 'var(--bg)',
              }}
            >
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                }}
              >
                {c.label}
              </div>
              <div
                style={{
                  fontFamily: 'var(--mono)',
                  fontWeight: 500,
                  fontSize: 28,
                  fontVariantNumeric: 'tabular-nums',
                  marginTop: 7,
                }}
              >
                {c.value}
              </div>
              {c.sub ? (
                <div
                  style={{
                    fontSize: 12,
                    color: c.tone === 'attention' ? 'var(--accent-deep)' : 'var(--moss-text)',
                    marginTop: 3,
                  }}
                >
                  {c.sub}
                </div>
              ) : null}
            </div>
          ))}
        </div>

        {/* Quick launch */}
        <SectionHeading kicker="Pinned" title="Quick launch" />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
            gap: 12,
            marginBottom: 36,
          }}
        >
          {quickLaunch.map((q) => (
            <Link
              key={q.slug}
              href={`/t/${q.slug}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: '14px 16px',
                background: 'var(--bg)',
                textDecoration: 'none',
                color: 'var(--text)',
              }}
            >
              <span
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 'var(--radius)',
                  background: 'var(--bg-subtle)',
                  border: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 17,
                  flexShrink: 0,
                }}
              >
                {q.icon}
              </span>
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    display: 'block',
                    fontFamily: 'var(--serif)',
                    fontSize: 16,
                    fontWeight: 400,
                  }}
                >
                  {q.title}
                </span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)' }}>
                  {q.desc}
                </span>
              </span>
            </Link>
          ))}
        </div>

        {/* Workspace directory */}
        <SectionHeading kicker="Directory" title="Workspaces" />
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          {bases.map((b, i) => {
            const count = tables.filter((t) => t.base_id === b.id).length
            const first = tables.find((t) => t.base_id === b.id)
            return (
              <div
                key={b.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '13px 16px',
                  borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                  background: 'var(--bg)',
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    fontFamily: 'var(--mono)',
                    color: 'var(--moss-text)',
                    background: 'var(--moss-soft)',
                    borderRadius: 999,
                    padding: '3px 10px',
                  }}
                >
                  {count} tables
                </span>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                  {b.icon ? `${b.icon} ` : ''}
                  {b.name}
                </span>
                <span style={{ flex: 1 }} />
                {first ? (
                  <Link
                    href={`/t/${first.slug}`}
                    style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', textDecoration: 'none' }}
                  >
                    Open
                  </Link>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function SectionHeading({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--text-faint)',
        }}
      >
        {kicker}
      </div>
      <h2 style={{ fontFamily: 'var(--serif)', fontSize: 19, fontWeight: 400, margin: '3px 0 0' }}>
        {title}
      </h2>
    </div>
  )
}
