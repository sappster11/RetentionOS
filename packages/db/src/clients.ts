import { query, queryOne } from './pool'
import { slugify } from './util'
import type { Client, ClientStatus, ClientTier, LifecycleStage } from './types'

const CLIENT_COLUMNS = `
  id, organization_id, name, slug, status, lifecycle_stage, tier, health_score,
  owner_id, website, industry, contract_start, contract_end, mrr, metadata,
  archived_at, created_at, updated_at
`

export interface ListClientsOptions {
  status?: ClientStatus
  includeArchived?: boolean
  limit?: number
}

/** Tenant-scoped: always filtered by organization_id. */
export async function listClients(
  orgId: string,
  opts: ListClientsOptions = {},
): Promise<Client[]> {
  const params: unknown[] = [orgId]
  let sql = `select ${CLIENT_COLUMNS} from public.clients where organization_id = $1`
  if (!opts.includeArchived) sql += ' and archived_at is null'
  if (opts.status) {
    params.push(opts.status)
    sql += ` and status = $${params.length}`
  }
  sql += ' order by name asc'
  if (opts.limit) {
    params.push(opts.limit)
    sql += ` limit $${params.length}`
  }
  return query<Client>(sql, params)
}

export async function getClient(orgId: string, id: string): Promise<Client | null> {
  return queryOne<Client>(
    `select ${CLIENT_COLUMNS} from public.clients where organization_id = $1 and id = $2`,
    [orgId, id],
  )
}

export interface CreateClientInput {
  name: string
  status?: ClientStatus
  lifecycle_stage?: LifecycleStage
  tier?: ClientTier
  website?: string
  industry?: string
  owner_id?: string
}

export async function createClient(orgId: string, input: CreateClientInput): Promise<Client> {
  const row = await queryOne<Client>(
    `insert into public.clients
       (organization_id, name, slug, status, lifecycle_stage, tier, website, industry, owner_id)
     values ($1, $2, $3,
             coalesce($4::public.client_status, 'prospect'),
             coalesce($5::public.lifecycle_stage, 'lead'),
             coalesce($6::public.client_tier, 'standard'),
             $7, $8, $9)
     returning ${CLIENT_COLUMNS}`,
    [
      orgId,
      input.name,
      slugify(input.name),
      input.status ?? null,
      input.lifecycle_stage ?? null,
      input.tier ?? null,
      input.website ?? null,
      input.industry ?? null,
      input.owner_id ?? null,
    ],
  )
  if (!row) throw new Error('Failed to create client')
  return row
}

export interface UpdateClientPatch {
  status?: ClientStatus
  lifecycle_stage?: LifecycleStage
  tier?: ClientTier
  health_score?: number
  owner_id?: string | null
  website?: string | null
  industry?: string | null
}

export async function updateClient(
  orgId: string,
  id: string,
  patch: UpdateClientPatch,
): Promise<Client | null> {
  const fields = Object.keys(patch) as Array<keyof UpdateClientPatch>
  if (fields.length === 0) return getClient(orgId, id)

  // Enum columns need an explicit cast — a bound text param won't assign to an enum.
  const enumCasts: Partial<Record<keyof UpdateClientPatch, string>> = {
    status: 'public.client_status',
    lifecycle_stage: 'public.lifecycle_stage',
    tier: 'public.client_tier',
  }

  const sets: string[] = []
  const params: unknown[] = [orgId, id]
  for (const field of fields) {
    params.push(patch[field])
    const cast = enumCasts[field]
    sets.push(`${field} = $${params.length}${cast ? `::${cast}` : ''}`)
  }
  return queryOne<Client>(
    `update public.clients set ${sets.join(', ')}
     where organization_id = $1 and id = $2
     returning ${CLIENT_COLUMNS}`,
    params,
  )
}

export async function archiveClient(orgId: string, id: string): Promise<void> {
  await query(
    `update public.clients set archived_at = now()
     where organization_id = $1 and id = $2 and archived_at is null`,
    [orgId, id],
  )
}
