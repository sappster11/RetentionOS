import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getClient, getCampaign, listVariants } from '@retentionos/db'
import { previewPersonalized } from '@retentionos/content'
import { getCurrentOrg } from '@/lib/org'
import { Card, CampaignStatusBadge, buttonStyle, linkStyle } from '../../../../_components/ui'
import { approveCampaignAction, queueCampaignAction } from '@/app/campaigns/actions'

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string; campaignId: string }>
}) {
  const { id, campaignId } = await params
  const org = await getCurrentOrg()
  const client = await getClient(org.id, id)
  if (!client) notFound()

  const campaign = await getCampaign(org.id, campaignId)
  if (!campaign) notFound()

  const [variants, preview] = await Promise.all([
    listVariants(org.id, campaignId),
    campaign.audience_id
      ? previewPersonalized({ orgId: org.id, campaignId, limit: 3 })
      : Promise.resolve(null),
  ])

  const canApprove = campaign.status === 'draft' || campaign.status === 'in_review'
  const canQueue = campaign.status === 'approved'

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '3rem 1.5rem' }}>
      <p style={{ marginTop: 0 }}>
        <Link href={`/clients/${client.id}/campaigns`} style={linkStyle}>
          ← {client.name} · Campaigns
        </Link>
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '1.6rem', margin: 0 }}>{campaign.name}</h1>
        <CampaignStatusBadge status={campaign.status} />
      </div>

      <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.6rem', opacity: 0.75, flexWrap: 'wrap' }}>
        <span style={{ textTransform: 'uppercase' }}>{campaign.channel}</span>
        <span style={{ textTransform: 'capitalize' }}>Goal: {campaign.goal}</span>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
        {canApprove ? (
          <form action={approveCampaignAction}>
            <input type="hidden" name="campaign_id" value={campaign.id} />
            <button type="submit" style={buttonStyle}>
              Approve
            </button>
          </form>
        ) : null}
        {canQueue ? (
          <form action={queueCampaignAction}>
            <input type="hidden" name="campaign_id" value={campaign.id} />
            <button type="submit" style={{ ...buttonStyle, background: '#1c3a2a' }}>
              Queue send
            </button>
          </form>
        ) : null}
      </div>
      <p style={{ opacity: 0.5, fontSize: '0.8rem', marginTop: '0.5rem' }}>
        Real delivery is pending provider credentials — queuing only creates message records.
      </p>

      <div style={{ marginTop: '2rem' }}>
        <Card title="Variants">
          {variants.length === 0 ? (
            <p style={{ opacity: 0.6 }}>No variants yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {variants.map((variant) => (
                <div
                  key={variant.id}
                  style={{
                    background: '#0f1012',
                    border: '1px solid #24262b',
                    borderRadius: 8,
                    padding: '0.9rem 1rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <strong>Variant {variant.label}</strong>
                    {variant.model_used ? (
                      <span
                        style={{
                          opacity: 0.5,
                          fontSize: '0.7rem',
                          background: '#1a1b1e',
                          borderRadius: 999,
                          padding: '0.1rem 0.5rem',
                        }}
                      >
                        {variant.model_used}
                      </span>
                    ) : null}
                  </div>
                  {campaign.channel === 'email' && variant.subject ? (
                    <div style={{ fontWeight: 600, marginBottom: '0.4rem' }}>{variant.subject}</div>
                  ) : null}
                  <pre
                    style={{
                      whiteSpace: 'pre-wrap',
                      fontFamily: 'inherit',
                      fontSize: '0.9rem',
                      margin: 0,
                      opacity: 0.9,
                    }}
                  >
                    {variant.body}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Personalized preview">
          {!preview || preview.members.length === 0 ? (
            <p style={{ opacity: 0.6 }}>No audience members to preview.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {preview.members.map((member) => (
                <div
                  key={member.customer_id}
                  style={{
                    background: '#0f1012',
                    border: '1px solid #24262b',
                    borderRadius: 8,
                    padding: '0.9rem 1rem',
                  }}
                >
                  <div style={{ fontSize: '0.8rem', opacity: 0.6, marginBottom: '0.5rem' }}>
                    {member.first_name ?? 'Unknown'}
                    {member.email ? ` · ${member.email}` : ''}
                  </div>
                  {member.variants.map((variant) => (
                    <div key={variant.label} style={{ marginBottom: '0.6rem' }}>
                      <div style={{ fontSize: '0.7rem', opacity: 0.5, marginBottom: '0.2rem' }}>
                        Variant {variant.label}
                      </div>
                      {campaign.channel === 'email' && variant.subject ? (
                        <div style={{ fontWeight: 600, marginBottom: '0.2rem' }}>{variant.subject}</div>
                      ) : null}
                      <pre
                        style={{
                          whiteSpace: 'pre-wrap',
                          fontFamily: 'inherit',
                          fontSize: '0.85rem',
                          margin: 0,
                          opacity: 0.9,
                        }}
                      >
                        {variant.body}
                      </pre>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </main>
  )
}
