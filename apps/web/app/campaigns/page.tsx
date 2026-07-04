import Link from 'next/link'
import { listCampaigns, listClients } from '@retentionos/db'
import { getCurrentOrg } from '@/lib/org'
import { Card, CampaignStatusBadge, linkStyle } from '../_components/ui'

export default async function CampaignsPage() {
  const org = await getCurrentOrg()
  const [campaigns, clients] = await Promise.all([listCampaigns(org.id), listClients(org.id)])

  const clientNameById = new Map<string, string>()
  for (const client of clients) {
    clientNameById.set(client.id, client.name)
  }

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '3rem 1.5rem' }}>
      <p style={{ marginTop: 0 }}>
        <Link href="/clients" style={linkStyle}>
          ← All clients
        </Link>
      </p>

      <h1 style={{ fontSize: '1.6rem', margin: 0 }}>Campaigns</h1>
      <p style={{ opacity: 0.6, marginTop: '0.25rem' }}>{org.name}</p>

      <Card>
        {campaigns.length === 0 ? (
          <p style={{ opacity: 0.6 }}>No campaigns yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', fontSize: '0.75rem', opacity: 0.6 }}>
                <th style={{ padding: '0.4rem 0.5rem' }}>Name</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Client</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Channel</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Goal</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((campaign) => (
                <tr key={campaign.id} style={{ borderTop: '1px solid #24262b' }}>
                  <td style={{ padding: '0.5rem' }}>
                    <Link href={`/clients/${campaign.client_id}/campaigns/${campaign.id}`} style={linkStyle}>
                      {campaign.name}
                    </Link>
                  </td>
                  <td style={{ padding: '0.5rem' }}>
                    <Link href={`/clients/${campaign.client_id}/campaigns`} style={linkStyle}>
                      {clientNameById.get(campaign.client_id) ?? 'Unknown client'}
                    </Link>
                  </td>
                  <td style={{ padding: '0.5rem', textTransform: 'uppercase', fontSize: '0.8rem' }}>
                    {campaign.channel}
                  </td>
                  <td style={{ padding: '0.5rem', textTransform: 'capitalize' }}>{campaign.goal}</td>
                  <td style={{ padding: '0.5rem' }}>
                    <CampaignStatusBadge status={campaign.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </main>
  )
}

export const dynamic = "force-dynamic"
