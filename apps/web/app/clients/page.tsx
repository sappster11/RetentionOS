import Link from 'next/link'
import { listClients, type ClientStatus } from '@retentionos/db'
import { getCurrentOrg } from '@/lib/org'
import { authEnabled, getSessionUser } from '@/lib/auth'
import { Card, StatusBadge, Field, inputStyle, buttonStyle, linkStyle } from '../_components/ui'
import { createClientAction } from './actions'
import { signOutAction } from '../auth/actions'

const STATUS_OPTIONS: ClientStatus[] = [
  'prospect',
  'onboarding',
  'active',
  'at_risk',
  'churned',
  'paused',
]

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const { status } = await searchParams
  const org = await getCurrentOrg()
  const sessionUser = authEnabled ? await getSessionUser() : null
  const filterStatus =
    status && (STATUS_OPTIONS as string[]).includes(status) ? (status as ClientStatus) : undefined
  const clients = await listClients(org.id, { status: filterStatus })

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '3rem 1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
        <h1 style={{ fontSize: '1.6rem', marginBottom: '0.25rem' }}>Clients</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link href="/dashboard" style={linkStyle}>
            Dashboard →
          </Link>
          <Link href="/chat" style={linkStyle}>
            Chat →
          </Link>
          <Link href="/tasks" style={linkStyle}>
            Tasks →
          </Link>
          <Link href="/campaigns" style={linkStyle}>
            Campaigns →
          </Link>
          {sessionUser ? (
            <form action={signOutAction} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ opacity: 0.5, fontSize: '0.8rem' }}>{sessionUser.email}</span>
              <button type="submit" style={{ ...linkStyle, background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem' }}>
                Sign out
              </button>
            </form>
          ) : null}
        </div>
      </div>
      <p style={{ opacity: 0.6, marginTop: 0 }}>{org.name}</p>

      <div style={{ display: 'flex', gap: '0.5rem', margin: '1.25rem 0', flexWrap: 'wrap' }}>
        <Link href="/clients" style={{ ...linkStyle, opacity: filterStatus ? 0.6 : 1 }}>
          All
        </Link>
        {STATUS_OPTIONS.map((s) => (
          <Link
            key={s}
            href={`/clients?status=${s}`}
            style={{ ...linkStyle, opacity: filterStatus === s ? 1 : 0.6 }}
          >
            {s.replace('_', ' ')}
          </Link>
        ))}
      </div>

      <Card>
        {clients.length === 0 ? (
          <p style={{ opacity: 0.6 }}>No clients found{filterStatus ? ` with status "${filterStatus}"` : ''}.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', fontSize: '0.75rem', opacity: 0.6 }}>
                <th style={{ padding: '0.4rem 0.5rem' }}>Name</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Status</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Tier</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Lifecycle</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Health</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Industry</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => (
                <tr key={client.id} style={{ borderTop: '1px solid #24262b' }}>
                  <td style={{ padding: '0.5rem' }}>
                    <Link href={`/clients/${client.id}`} style={linkStyle}>
                      {client.name}
                    </Link>
                  </td>
                  <td style={{ padding: '0.5rem' }}>
                    <StatusBadge status={client.status} />
                  </td>
                  <td style={{ padding: '0.5rem', textTransform: 'capitalize' }}>{client.tier}</td>
                  <td style={{ padding: '0.5rem', textTransform: 'capitalize' }}>
                    {client.lifecycle_stage}
                  </td>
                  <td style={{ padding: '0.5rem' }}>{client.health_score ?? '—'}</td>
                  <td style={{ padding: '0.5rem' }}>{client.industry ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="New client">
        <form
          action={createClientAction}
          style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}
        >
          <Field label="Name" style={{ flex: '1 1 200px' }}>
            <input name="name" required style={inputStyle} placeholder="Acme Corp" />
          </Field>
          <Field label="Status">
            <select name="status" defaultValue="prospect" style={inputStyle}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s.replace('_', ' ')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tier">
            <select name="tier" defaultValue="standard" style={inputStyle}>
              <option value="standard">Standard</option>
              <option value="premium">Premium</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </Field>
          <button type="submit" style={buttonStyle}>
            Create client
          </button>
        </form>
      </Card>
    </main>
  )
}
