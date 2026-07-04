import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  getClient,
  listCampaigns,
  type CampaignChannel,
  type CampaignGoal,
} from '@retentionos/db'
import { getCurrentOrg } from '@/lib/org'
import { Card, CampaignStatusBadge, Field, inputStyle, buttonStyle, linkStyle, formatDate } from '../../../_components/ui'
import { draftCampaignAction } from '@/app/campaigns/actions'

const CHANNELS: CampaignChannel[] = ['email', 'sms']

const GOALS: CampaignGoal[] = ['winback', 'onboarding', 'retention', 'reengagement', 'announcement']

const SEGMENTS = ['new', 'active', 'at_risk', 'churned', 'won_back', 'vip'] as const

export default async function ClientCampaignsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const org = await getCurrentOrg()
  const client = await getClient(org.id, id)
  if (!client) notFound()

  const campaigns = await listCampaigns(org.id, { clientId: client.id })

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '3rem 1.5rem' }}>
      <p style={{ marginTop: 0 }}>
        <Link href={`/clients/${client.id}`} style={linkStyle}>
          ← {client.name}
        </Link>
      </p>

      <h1 style={{ fontSize: '1.6rem', margin: 0 }}>{client.name} · Campaigns</h1>

      <Card>
        {campaigns.length === 0 ? (
          <p style={{ opacity: 0.6 }}>No campaigns yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', fontSize: '0.75rem', opacity: 0.6 }}>
                <th style={{ padding: '0.4rem 0.5rem' }}>Name</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Channel</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Goal</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Status</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Created</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((campaign) => (
                <tr key={campaign.id} style={{ borderTop: '1px solid #24262b' }}>
                  <td style={{ padding: '0.5rem' }}>
                    <Link href={`/clients/${client.id}/campaigns/${campaign.id}`} style={linkStyle}>
                      {campaign.name}
                    </Link>
                  </td>
                  <td style={{ padding: '0.5rem', textTransform: 'uppercase', fontSize: '0.8rem' }}>
                    {campaign.channel}
                  </td>
                  <td style={{ padding: '0.5rem', textTransform: 'capitalize' }}>{campaign.goal}</td>
                  <td style={{ padding: '0.5rem' }}>
                    <CampaignStatusBadge status={campaign.status} />
                  </td>
                  <td style={{ padding: '0.5rem' }}>{formatDate(campaign.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Draft a campaign">
        <form
          action={draftCampaignAction}
          style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}
        >
          <input type="hidden" name="client_id" value={client.id} />
          <Field label="Name" style={{ flex: '1 1 200px' }}>
            <input name="name" required style={inputStyle} placeholder="Winback — at risk customers" />
          </Field>
          <Field label="Channel">
            <select name="channel" defaultValue="email" style={inputStyle}>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c.toUpperCase()}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Goal">
            <select name="goal" defaultValue="winback" style={inputStyle}>
              {GOALS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Segment">
            <select name="segment" defaultValue="at_risk" style={inputStyle}>
              {SEGMENTS.map((s) => (
                <option key={s} value={s}>
                  {s.replace('_', ' ')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Min. lifetime spend">
            <input name="min_monetary" type="number" min="0" step="0.01" style={inputStyle} placeholder="optional" />
          </Field>
          <button type="submit" style={buttonStyle}>
            Draft campaign
          </button>
        </form>
      </Card>
    </main>
  )
}
