import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  getClient,
  listContacts,
  listChannels,
  listDocuments,
  listActivities,
  type ClientStatus,
  type ChannelKind,
} from '@retentionos/db'
import { getCurrentOrg } from '@/lib/org'
import { Card, StatusBadge, Field, inputStyle, buttonStyle, linkStyle, formatDate } from '../../_components/ui'
import {
  updateClientStatusAction,
  addContactAction,
  linkChannelAction,
  addNoteAction,
} from '../actions'

const STATUS_OPTIONS: ClientStatus[] = [
  'prospect',
  'onboarding',
  'active',
  'at_risk',
  'churned',
  'paused',
]

const CHANNEL_KINDS: ChannelKind[] = [
  'slack',
  'gdrive',
  'gcal',
  'notion',
  'airtable',
  'website',
  'other',
]

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const org = await getCurrentOrg()
  const client = await getClient(org.id, id)
  if (!client) notFound()

  const [contacts, channels, documents, activities] = await Promise.all([
    listContacts(org.id, client.id),
    listChannels(org.id, client.id),
    listDocuments(org.id, client.id),
    listActivities(org.id, client.id),
  ])

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '3rem 1.5rem' }}>
      <p style={{ marginTop: 0 }}>
        <Link href="/clients" style={linkStyle}>
          ← All clients
        </Link>
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '1.6rem', margin: 0 }}>{client.name}</h1>
        <StatusBadge status={client.status} />
        <Link href={`/clients/${client.id}/retention`} style={linkStyle}>
          Retention →
        </Link>
      </div>

      <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.6rem', opacity: 0.75, flexWrap: 'wrap' }}>
        <span style={{ textTransform: 'capitalize' }}>Tier: {client.tier}</span>
        <span style={{ textTransform: 'capitalize' }}>Lifecycle: {client.lifecycle_stage}</span>
        <span>Health: {client.health_score ?? '—'}</span>
        <span>Industry: {client.industry ?? '—'}</span>
        {client.website ? (
          <a href={client.website} target="_blank" rel="noreferrer" style={linkStyle}>
            {client.website}
          </a>
        ) : null}
      </div>

      <form
        action={updateClientStatusAction}
        style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', marginTop: '1rem' }}
      >
        <input type="hidden" name="client_id" value={client.id} />
        <Field label="Change status">
          <select name="status" defaultValue={client.status} style={inputStyle}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ')}
              </option>
            ))}
          </select>
        </Field>
        <button type="submit" style={buttonStyle}>
          Update status
        </button>
      </form>

      <div style={{ marginTop: '2rem' }}>
        <Card title="Contacts">
          {contacts.length === 0 ? (
            <p style={{ opacity: 0.6 }}>No contacts yet.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1rem 0' }}>
              {contacts.map((contact) => (
                <li
                  key={contact.id}
                  style={{ padding: '0.5rem 0', borderBottom: '1px solid #24262b' }}
                >
                  {contact.is_primary ? <span title="Primary contact">⭐ </span> : null}
                  <strong>{contact.full_name}</strong>
                  {contact.title ? <span style={{ opacity: 0.6 }}> — {contact.title}</span> : null}
                  {contact.email ? (
                    <span style={{ opacity: 0.6 }}>
                      {' · '}
                      <a href={`mailto:${contact.email}`} style={linkStyle}>
                        {contact.email}
                      </a>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <form
            action={addContactAction}
            style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}
          >
            <input type="hidden" name="client_id" value={client.id} />
            <Field label="Full name">
              <input name="full_name" required style={inputStyle} />
            </Field>
            <Field label="Title">
              <input name="title" style={inputStyle} />
            </Field>
            <Field label="Email">
              <input name="email" type="email" style={inputStyle} />
            </Field>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem' }}>
              <input type="checkbox" name="is_primary" /> Primary
            </label>
            <button type="submit" style={buttonStyle}>
              Add contact
            </button>
          </form>
        </Card>

        <Card title="Channels">
          {channels.length === 0 ? (
            <p style={{ opacity: 0.6 }}>No channels linked yet.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1rem 0' }}>
              {channels.map((channel) => (
                <li
                  key={channel.id}
                  style={{ padding: '0.5rem 0', borderBottom: '1px solid #24262b' }}
                >
                  <span
                    style={{
                      opacity: 0.6,
                      textTransform: 'uppercase',
                      fontSize: '0.7rem',
                      marginRight: '0.5rem',
                    }}
                  >
                    {channel.kind}
                  </span>
                  {channel.url ? (
                    <a href={channel.url} target="_blank" rel="noreferrer" style={linkStyle}>
                      {channel.name}
                    </a>
                  ) : (
                    <span>{channel.name}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <form
            action={linkChannelAction}
            style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}
          >
            <input type="hidden" name="client_id" value={client.id} />
            <Field label="Kind">
              <select name="kind" defaultValue="slack" style={inputStyle}>
                {CHANNEL_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Name">
              <input name="name" required style={inputStyle} />
            </Field>
            <Field label="URL">
              <input name="url" type="url" style={inputStyle} />
            </Field>
            <button type="submit" style={buttonStyle}>
              Link channel
            </button>
          </form>
        </Card>

        <Card title="Documents">
          {documents.length === 0 ? (
            <p style={{ opacity: 0.6 }}>No documents yet.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1rem 0' }}>
              {documents.map((doc) => (
                <li key={doc.id} style={{ padding: '0.5rem 0', borderBottom: '1px solid #24262b' }}>
                  <strong>{doc.title}</strong>
                  <span style={{ opacity: 0.6 }}>
                    {' '}
                    · {doc.source} · {formatDate(doc.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <form
            action={addNoteAction}
            style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}
          >
            <input type="hidden" name="client_id" value={client.id} />
            <Field label="Title" style={{ flex: '1 1 200px' }}>
              <input name="title" required style={inputStyle} />
            </Field>
            <Field label="Content" style={{ flex: '2 1 300px' }}>
              <textarea name="content" rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
            </Field>
            <button type="submit" style={buttonStyle}>
              Add note
            </button>
          </form>
        </Card>

        <Card title="Activity">
          {activities.length === 0 ? (
            <p style={{ opacity: 0.6 }}>No activity yet.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {activities.map((activity) => (
                <li
                  key={activity.id}
                  style={{ padding: '0.5rem 0', borderBottom: '1px solid #24262b' }}
                >
                  <span
                    style={{
                      opacity: 0.6,
                      textTransform: 'uppercase',
                      fontSize: '0.7rem',
                      marginRight: '0.5rem',
                    }}
                  >
                    {activity.actor_type}
                  </span>
                  <strong>{activity.verb}</strong>
                  {activity.summary ? <span> — {activity.summary}</span> : null}
                  <span style={{ opacity: 0.5, float: 'right', fontSize: '0.8rem' }}>
                    {formatDate(activity.occurred_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </main>
  )
}
