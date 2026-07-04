import { query, queryOne } from './pool'
import type { ActorType, Campaign, CampaignChannel, CampaignGoal, CampaignStatus, CampaignVariant } from './types'

const CAMPAIGN_COLUMNS = `
  id, organization_id, client_id, name, channel, goal, status, audience_id,
  created_by_type, created_by_id, metadata, created_at, updated_at
`

const CAMPAIGN_VARIANT_COLUMNS = `
  id, organization_id, campaign_id, label, subject, body, personalization_spec,
  model_used, status, created_at, updated_at
`

export interface ListCampaignsOptions {
  clientId?: string
  status?: CampaignStatus
}

/** Tenant-scoped: always filtered by organization_id. */
export async function listCampaigns(
  orgId: string,
  opts: ListCampaignsOptions = {},
): Promise<Campaign[]> {
  const params: unknown[] = [orgId]
  let sql = `select ${CAMPAIGN_COLUMNS} from public.campaigns where organization_id = $1`
  if (opts.clientId) {
    params.push(opts.clientId)
    sql += ` and client_id = $${params.length}`
  }
  if (opts.status) {
    params.push(opts.status)
    sql += ` and status = $${params.length}`
  }
  sql += ' order by created_at desc'
  return query<Campaign>(sql, params)
}

export async function getCampaign(orgId: string, id: string): Promise<Campaign | null> {
  return queryOne<Campaign>(
    `select ${CAMPAIGN_COLUMNS} from public.campaigns where organization_id = $1 and id = $2`,
    [orgId, id],
  )
}

export interface CreateCampaignInput {
  client_id: string
  name: string
  channel: CampaignChannel
  goal: CampaignGoal
  status?: CampaignStatus
  audience_id?: string
  created_by_type?: ActorType
  created_by_id?: string
}

export async function createCampaign(orgId: string, input: CreateCampaignInput): Promise<Campaign> {
  const row = await queryOne<Campaign>(
    `insert into public.campaigns
       (organization_id, client_id, name, channel, goal, status, audience_id,
        created_by_type, created_by_id)
     values ($1, $2, $3, $4::public.campaign_channel, $5::public.campaign_goal,
             coalesce($6::public.campaign_status, 'draft'),
             $7, coalesce($8::public.actor_type, 'user'), $9)
     returning ${CAMPAIGN_COLUMNS}`,
    [
      orgId,
      input.client_id,
      input.name,
      input.channel,
      input.goal,
      input.status ?? null,
      input.audience_id ?? null,
      input.created_by_type ?? null,
      input.created_by_id ?? null,
    ],
  )
  if (!row) throw new Error('Failed to create campaign')
  return row
}

export async function updateCampaignStatus(
  orgId: string,
  id: string,
  status: CampaignStatus,
): Promise<Campaign | null> {
  return queryOne<Campaign>(
    `update public.campaigns set status = $3::public.campaign_status
     where organization_id = $1 and id = $2
     returning ${CAMPAIGN_COLUMNS}`,
    [orgId, id, status],
  )
}

export interface CreateVariantInput {
  campaign_id: string
  label?: string
  subject?: string
  body?: string
  personalization_spec?: Record<string, unknown>
  model_used?: string
  status?: string
}

export async function createVariant(orgId: string, input: CreateVariantInput): Promise<CampaignVariant> {
  const row = await queryOne<CampaignVariant>(
    `insert into public.campaign_variants
       (organization_id, campaign_id, label, subject, body, personalization_spec, model_used, status)
     values ($1, $2, coalesce($3, 'A'), $4, $5, coalesce($6::jsonb, '{}'::jsonb), $7, coalesce($8, 'draft'))
     returning ${CAMPAIGN_VARIANT_COLUMNS}`,
    [
      orgId,
      input.campaign_id,
      input.label ?? null,
      input.subject ?? null,
      input.body ?? null,
      input.personalization_spec ? JSON.stringify(input.personalization_spec) : null,
      input.model_used ?? null,
      input.status ?? null,
    ],
  )
  if (!row) throw new Error('Failed to create campaign variant')
  return row
}

export async function listVariants(orgId: string, campaignId: string): Promise<CampaignVariant[]> {
  return query<CampaignVariant>(
    `select ${CAMPAIGN_VARIANT_COLUMNS} from public.campaign_variants
     where organization_id = $1 and campaign_id = $2
     order by label asc`,
    [orgId, campaignId],
  )
}
