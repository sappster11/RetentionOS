// Audiences are queries, not stored lists — an audience's `definition` jsonb is evaluated
// against the derived retention analytics (client_customer_metrics / client_customers, see
// clientData.ts) at read time. resolveAudience is the query builder that does that evaluation.

import { query, queryOne } from './pool'
import type { Audience, ResolvedAudienceMember } from './types'

const AUDIENCE_COLUMNS = `
  id, organization_id, client_id, name, definition, source, created_at, updated_at
`

export interface ListAudiencesOptions {
  clientId?: string
}

/** Tenant-scoped: always filtered by organization_id. */
export async function listAudiences(
  orgId: string,
  opts: ListAudiencesOptions = {},
): Promise<Audience[]> {
  const params: unknown[] = [orgId]
  let sql = `select ${AUDIENCE_COLUMNS} from public.audiences where organization_id = $1`
  if (opts.clientId) {
    params.push(opts.clientId)
    sql += ` and client_id = $${params.length}`
  }
  sql += ' order by name asc'
  return query<Audience>(sql, params)
}

export async function getAudience(orgId: string, id: string): Promise<Audience | null> {
  return queryOne<Audience>(
    `select ${AUDIENCE_COLUMNS} from public.audiences where organization_id = $1 and id = $2`,
    [orgId, id],
  )
}

export interface CreateAudienceInput {
  client_id: string
  name: string
  definition?: Record<string, unknown>
  source?: string
}

export async function createAudience(orgId: string, input: CreateAudienceInput): Promise<Audience> {
  const row = await queryOne<Audience>(
    `insert into public.audiences (organization_id, client_id, name, definition, source)
     values ($1, $2, $3, coalesce($4::jsonb, '{}'::jsonb), coalesce($5, 'internal'))
     returning ${AUDIENCE_COLUMNS}`,
    [
      orgId,
      input.client_id,
      input.name,
      input.definition ? JSON.stringify(input.definition) : null,
      input.source ?? null,
    ],
  )
  if (!row) throw new Error('Failed to create audience')
  return row
}

// ---------------------------------------------------------------------------
// resolveAudience
// ---------------------------------------------------------------------------

/**
 * Definition shape an audience's `definition` jsonb is expected to hold. All keys are
 * optional; resolveAudience builds its WHERE clause from whichever ones are present.
 */
export interface AudienceDefinition {
  /** Lifecycle stage to match, e.g. 'at_risk' — maps to client_customer_metrics.lifecycle_stage. */
  segment?: string
  /** Customer must have ordered within this many days (recency_days <= value). */
  max_recency_days?: number
  /** Customer's lifetime spend must be at least this much (monetary >= value). */
  min_monetary?: number
  /** Customer's RFM monetary score must be at least this much (rfm_monetary >= value). */
  min_rfm_monetary?: number
  /** Cap on the number of customers returned. */
  limit?: number
}

const RESOLVED_MEMBER_COLUMNS = `
  cc.id as customer_id, cc.first_name, cc.last_name, cc.email,
  m.recency_days, m.frequency, m.monetary, m.churn_risk, m.lifecycle_stage
`

/**
 * The core of "audiences are queries": evaluates an audience definition against
 * client_customer_metrics joined to client_customers, tenant- and client-scoped.
 */
export async function resolveAudience(
  orgId: string,
  clientId: string,
  definition: AudienceDefinition,
): Promise<ResolvedAudienceMember[]> {
  const params: unknown[] = [orgId, clientId]
  let sql = `
    select ${RESOLVED_MEMBER_COLUMNS}
    from public.client_customer_metrics m
    join public.client_customers cc
      on cc.id = m.customer_id
     and cc.organization_id = m.organization_id
     and cc.client_id = m.client_id
    where m.organization_id = $1 and m.client_id = $2
  `

  if (definition.segment) {
    params.push(definition.segment)
    sql += ` and m.lifecycle_stage = $${params.length}::public.lifecycle_stage_customer`
  }
  if (definition.max_recency_days !== undefined) {
    params.push(definition.max_recency_days)
    sql += ` and m.recency_days <= $${params.length}`
  }
  if (definition.min_monetary !== undefined) {
    params.push(definition.min_monetary)
    sql += ` and m.monetary >= $${params.length}`
  }
  if (definition.min_rfm_monetary !== undefined) {
    params.push(definition.min_rfm_monetary)
    sql += ` and m.rfm_monetary >= $${params.length}`
  }

  sql += ' order by m.monetary desc'
  if (definition.limit) {
    params.push(definition.limit)
    sql += ` limit $${params.length}`
  }

  return query<ResolvedAudienceMember>(sql, params)
}
