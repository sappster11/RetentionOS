import { query, queryOne } from './pool'
import type { Channel, ChannelKind } from './types'

const CHANNEL_COLUMNS = `
  id, organization_id, client_id, kind, name, external_id, url, metadata,
  last_synced_at, created_at, updated_at
`

export async function listChannels(orgId: string, clientId: string): Promise<Channel[]> {
  return query<Channel>(
    `select ${CHANNEL_COLUMNS} from public.channels
     where organization_id = $1 and client_id = $2
     order by kind asc, name asc`,
    [orgId, clientId],
  )
}

export interface LinkChannelInput {
  client_id: string
  kind: ChannelKind
  name: string
  url?: string
  external_id?: string
}

export async function linkChannel(orgId: string, input: LinkChannelInput): Promise<Channel> {
  const row = await queryOne<Channel>(
    `insert into public.channels (organization_id, client_id, kind, name, url, external_id)
     values ($1, $2, $3::public.channel_kind, $4, $5, $6)
     returning ${CHANNEL_COLUMNS}`,
    [orgId, input.client_id, input.kind, input.name, input.url ?? null, input.external_id ?? null],
  )
  if (!row) throw new Error('Failed to link channel')
  return row
}
