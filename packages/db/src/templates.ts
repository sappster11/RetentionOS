import { query, queryOne } from './pool'
import type { CampaignChannel, Template } from './types'

const TEMPLATE_COLUMNS = `
  id, organization_id, client_id, channel, name, subject, body, variables, created_at, updated_at
`

export interface ListTemplatesOptions {
  clientId?: string
  channel?: CampaignChannel
}

/** Tenant-scoped: always filtered by organization_id. Includes agency-wide templates
 *  (client_id is null) alongside any client-specific ones when clientId is passed. */
export async function listTemplates(
  orgId: string,
  opts: ListTemplatesOptions = {},
): Promise<Template[]> {
  const params: unknown[] = [orgId]
  let sql = `select ${TEMPLATE_COLUMNS} from public.templates where organization_id = $1`
  if (opts.clientId) {
    params.push(opts.clientId)
    sql += ` and (client_id = $${params.length} or client_id is null)`
  }
  if (opts.channel) {
    params.push(opts.channel)
    sql += ` and channel = $${params.length}::public.campaign_channel`
  }
  sql += ' order by name asc'
  return query<Template>(sql, params)
}

export async function getTemplate(orgId: string, id: string): Promise<Template | null> {
  return queryOne<Template>(
    `select ${TEMPLATE_COLUMNS} from public.templates where organization_id = $1 and id = $2`,
    [orgId, id],
  )
}

export interface CreateTemplateInput {
  client_id?: string
  channel: CampaignChannel
  name: string
  subject?: string
  body?: string
  variables?: Record<string, unknown>
}

export async function createTemplate(orgId: string, input: CreateTemplateInput): Promise<Template> {
  const row = await queryOne<Template>(
    `insert into public.templates (organization_id, client_id, channel, name, subject, body, variables)
     values ($1, $2, $3::public.campaign_channel, $4, $5, $6, coalesce($7::jsonb, '{}'::jsonb))
     returning ${TEMPLATE_COLUMNS}`,
    [
      orgId,
      input.client_id ?? null,
      input.channel,
      input.name,
      input.subject ?? null,
      input.body ?? null,
      input.variables ? JSON.stringify(input.variables) : null,
    ],
  )
  if (!row) throw new Error('Failed to create template')
  return row
}
