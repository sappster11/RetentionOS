'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import {
  getAudience,
  getCampaign,
  createMessage,
  listVariants,
  logActivity,
  resolveAudience,
  updateCampaignStatus,
  type AudienceDefinition,
  type CampaignChannel,
  type CampaignGoal,
  type MessageProvider,
} from '@retentionos/db'
import { draftCampaign, personalize } from '@retentionos/content'
import { getCurrentOrg } from '@/lib/org'

function requireString(formData: FormData, field: string): string {
  const value = formData.get(field)
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required field: ${field}`)
  }
  return value.trim()
}

function optionalString(formData: FormData, field: string): string | undefined {
  const value = formData.get(field)
  if (typeof value !== 'string' || value.trim() === '') return undefined
  return value.trim()
}

function defaultProviderFor(channel: CampaignChannel): MessageProvider {
  return channel === 'email' ? 'resend' : 'twilio'
}

/**
 * Draft a campaign for a client: resolves the audience definition from the form, calls
 * @retentionos/content's draftCampaign (which persists the audience/campaign/variants and
 * uses the keyless template fallback when no model is configured), then redirects to the
 * new campaign's detail page for review.
 */
export async function draftCampaignAction(formData: FormData): Promise<void> {
  const org = await getCurrentOrg()
  const clientId = requireString(formData, 'client_id')
  const name = requireString(formData, 'name')
  const channel = requireString(formData, 'channel') as CampaignChannel
  const goal = requireString(formData, 'goal') as CampaignGoal
  const segment = optionalString(formData, 'segment')
  const minMonetaryRaw = optionalString(formData, 'min_monetary')
  const minMonetary = minMonetaryRaw !== undefined ? Number(minMonetaryRaw) : undefined

  const audienceDefinition: AudienceDefinition = {
    segment,
    min_monetary: minMonetary !== undefined && !Number.isNaN(minMonetary) ? minMonetary : undefined,
  }

  const { campaign } = await draftCampaign({
    orgId: org.id,
    clientId,
    name,
    channel,
    goal,
    audienceDefinition,
  })

  revalidatePath(`/clients/${clientId}/campaigns`)
  revalidatePath('/campaigns')
  redirect(`/clients/${clientId}/campaigns/${campaign.id}`)
}

/** Move a campaign from draft/in_review to approved — the gate queueCampaignAction requires. */
export async function approveCampaignAction(formData: FormData): Promise<void> {
  const org = await getCurrentOrg()
  const campaignId = requireString(formData, 'campaign_id')

  const campaign = await updateCampaignStatus(org.id, campaignId, 'approved')
  if (!campaign) throw new Error('Campaign not found')

  await logActivity(org.id, {
    client_id: campaign.client_id,
    actor_type: 'user',
    verb: 'campaign.approved',
    summary: `Approved campaign "${campaign.name}"`,
    data: { campaign_id: campaign.id },
  })

  revalidatePath(`/clients/${campaign.client_id}/campaigns/${campaign.id}`)
  revalidatePath(`/clients/${campaign.client_id}/campaigns`)
  revalidatePath('/campaigns')
}

/**
 * Queue a campaign for delivery: requires the campaign to already be "approved", then
 * re-resolves its audience and creates one `messages` row per member (subject/body
 * personalized from variant A), marks the campaign "sent", and logs a campaign.queued
 * activity. Mirrors mcp-content's queue_send tool. Does NOT call any ESP — real delivery
 * is stubbed pending provider credentials.
 */
export async function queueCampaignAction(formData: FormData): Promise<void> {
  const org = await getCurrentOrg()
  const campaignId = requireString(formData, 'campaign_id')

  const campaign = await getCampaign(org.id, campaignId)
  if (!campaign) throw new Error('Campaign not found')
  if (campaign.status !== 'approved') {
    throw new Error('Campaign must be approved before it can be queued.')
  }
  if (!campaign.audience_id) {
    throw new Error(`Campaign ${campaignId} has no associated audience to send to.`)
  }

  const audience = await getAudience(org.id, campaign.audience_id)
  if (!audience) throw new Error(`No audience found with id ${campaign.audience_id}.`)

  const variants = await listVariants(org.id, campaignId)
  const variantA = variants.find((v) => v.label === 'A') ?? variants[0]
  if (!variantA) throw new Error(`Campaign ${campaignId} has no variants to send.`)

  const members = await resolveAudience(
    org.id,
    campaign.client_id,
    audience.definition as unknown as AudienceDefinition,
  )

  const provider = defaultProviderFor(campaign.channel)

  for (const member of members) {
    await createMessage(org.id, {
      client_id: campaign.client_id,
      campaign_id: campaign.id,
      customer_id: member.customer_id,
      channel: campaign.channel,
      to_address: campaign.channel === 'email' ? member.email ?? undefined : undefined,
      rendered_subject: variantA.subject ? personalize(variantA.subject, member) : undefined,
      rendered_body: variantA.body ? personalize(variantA.body, member) : undefined,
      provider,
      status: 'queued',
    })
  }

  await updateCampaignStatus(org.id, campaignId, 'sent')

  await logActivity(org.id, {
    client_id: campaign.client_id,
    actor_type: 'user',
    verb: 'campaign.queued',
    summary:
      `Queued ${members.length} message(s) for campaign "${campaign.name}"; delivery ` +
      'integration pending provider credentials.',
    data: { campaign_id: campaign.id, message_count: members.length, provider },
  })

  revalidatePath(`/clients/${campaign.client_id}/campaigns/${campaign.id}`)
  revalidatePath(`/clients/${campaign.client_id}/campaigns`)
  revalidatePath('/campaigns')
}
