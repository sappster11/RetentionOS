import { query, queryOne } from './pool'
import type { CampaignChannel, Message, MessageProvider, MessageStatus } from './types'

const MESSAGE_COLUMNS = `
  id, organization_id, campaign_id, client_id, customer_id, channel, to_address,
  rendered_subject, rendered_body, provider, provider_ref, status, sent_at, created_at
`

export interface CreateMessageInput {
  client_id: string
  channel: CampaignChannel
  campaign_id?: string
  customer_id?: string
  to_address?: string
  rendered_subject?: string
  rendered_body?: string
  provider?: MessageProvider
  provider_ref?: string
  status?: MessageStatus
  sent_at?: string
}

export async function createMessage(orgId: string, input: CreateMessageInput): Promise<Message> {
  const row = await queryOne<Message>(
    `insert into public.messages
       (organization_id, campaign_id, client_id, customer_id, channel, to_address,
        rendered_subject, rendered_body, provider, provider_ref, status, sent_at)
     values ($1, $2, $3, $4, $5::public.campaign_channel, $6, $7, $8,
             $9::public.message_provider, $10, coalesce($11::public.message_status, 'queued'), $12)
     returning ${MESSAGE_COLUMNS}`,
    [
      orgId,
      input.campaign_id ?? null,
      input.client_id,
      input.customer_id ?? null,
      input.channel,
      input.to_address ?? null,
      input.rendered_subject ?? null,
      input.rendered_body ?? null,
      input.provider ?? null,
      input.provider_ref ?? null,
      input.status ?? null,
      input.sent_at ?? null,
    ],
  )
  if (!row) throw new Error('Failed to create message')
  return row
}

export interface ListMessagesOptions {
  campaignId?: string
  clientId?: string
}

/** Tenant-scoped: always filtered by organization_id. */
export async function listMessages(
  orgId: string,
  opts: ListMessagesOptions = {},
): Promise<Message[]> {
  const params: unknown[] = [orgId]
  let sql = `select ${MESSAGE_COLUMNS} from public.messages where organization_id = $1`
  if (opts.campaignId) {
    params.push(opts.campaignId)
    sql += ` and campaign_id = $${params.length}`
  }
  if (opts.clientId) {
    params.push(opts.clientId)
    sql += ` and client_id = $${params.length}`
  }
  sql += ' order by created_at desc'
  return query<Message>(sql, params)
}
