import { query, queryOne } from './pool'
import type { Activity, ActorType } from './types'

const ACTIVITY_COLUMNS = `
  id, organization_id, client_id, actor_type, actor_id, verb, summary, data,
  occurred_at, created_at
`

export async function listActivities(
  orgId: string,
  clientId: string,
  limit = 50,
): Promise<Activity[]> {
  return query<Activity>(
    `select ${ACTIVITY_COLUMNS} from public.activities
     where organization_id = $1 and client_id = $2
     order by occurred_at desc
     limit $3`,
    [orgId, clientId, limit],
  )
}

export interface LogActivityInput {
  client_id?: string | null
  actor_type?: ActorType
  actor_id?: string | null
  verb: string
  summary?: string
  data?: Record<string, unknown>
}

/**
 * Append to the unified timeline. Every meaningful mutation (from the UI, an agent, or a
 * sync job) should call this so the client history and audit trail stay complete.
 */
export async function logActivity(orgId: string, input: LogActivityInput): Promise<Activity> {
  const row = await queryOne<Activity>(
    `insert into public.activities
       (organization_id, client_id, actor_type, actor_id, verb, summary, data)
     values ($1, $2, coalesce($3::public.actor_type, 'user'), $4, $5, $6,
             coalesce($7::jsonb, '{}'::jsonb))
     returning ${ACTIVITY_COLUMNS}`,
    [
      orgId,
      input.client_id ?? null,
      input.actor_type ?? null,
      input.actor_id ?? null,
      input.verb,
      input.summary ?? null,
      input.data ? JSON.stringify(input.data) : null,
    ],
  )
  if (!row) throw new Error('Failed to log activity')
  return row
}
