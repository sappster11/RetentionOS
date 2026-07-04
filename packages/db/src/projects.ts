import { query, queryOne } from './pool'
import type { Project, ProjectStatus, TaskStatus } from './types'

const PROJECT_COLUMNS = `
  id, organization_id, client_id, name, status, owner_id, starts_on, due_on,
  metadata, created_at, updated_at
`

export interface ListProjectsOptions {
  clientId?: string
  status?: ProjectStatus
}

/** Tenant-scoped: always filtered by organization_id. */
export async function listProjects(
  orgId: string,
  opts: ListProjectsOptions = {},
): Promise<Project[]> {
  const params: unknown[] = [orgId]
  let sql = `select ${PROJECT_COLUMNS} from public.projects where organization_id = $1`
  if (opts.clientId) {
    params.push(opts.clientId)
    sql += ` and client_id = $${params.length}`
  }
  if (opts.status) {
    params.push(opts.status)
    sql += ` and status = $${params.length}`
  }
  sql += ' order by created_at asc'
  return query<Project>(sql, params)
}

export async function getProject(orgId: string, id: string): Promise<Project | null> {
  return queryOne<Project>(
    `select ${PROJECT_COLUMNS} from public.projects where organization_id = $1 and id = $2`,
    [orgId, id],
  )
}

export interface CreateProjectInput {
  client_id?: string
  name: string
  status?: ProjectStatus
  owner_id?: string
  starts_on?: string
  due_on?: string
}

export async function createProject(orgId: string, input: CreateProjectInput): Promise<Project> {
  const row = await queryOne<Project>(
    `insert into public.projects
       (organization_id, client_id, name, status, owner_id, starts_on, due_on)
     values ($1, $2, $3,
             coalesce($4::public.project_status, 'planned'),
             $5, $6, $7)
     returning ${PROJECT_COLUMNS}`,
    [
      orgId,
      input.client_id ?? null,
      input.name,
      input.status ?? null,
      input.owner_id ?? null,
      input.starts_on ?? null,
      input.due_on ?? null,
    ],
  )
  if (!row) throw new Error('Failed to create project')
  return row
}

export interface UpdateProjectPatch {
  name?: string
  status?: ProjectStatus
  owner_id?: string | null
  starts_on?: string | null
  due_on?: string | null
  metadata?: Record<string, unknown>
}

export async function updateProject(
  orgId: string,
  id: string,
  patch: UpdateProjectPatch,
): Promise<Project | null> {
  const fields = Object.keys(patch) as Array<keyof UpdateProjectPatch>
  if (fields.length === 0) return getProject(orgId, id)

  // Enum columns need an explicit cast — a bound text param won't assign to an enum.
  const enumCasts: Partial<Record<keyof UpdateProjectPatch, string>> = {
    status: 'public.project_status',
  }

  const sets: string[] = []
  const params: unknown[] = [orgId, id]
  for (const field of fields) {
    const value = patch[field]
    params.push(field === 'metadata' ? JSON.stringify(value) : value)
    const cast = enumCasts[field]
    sets.push(`${field} = $${params.length}${cast ? `::${cast}` : ''}`)
  }
  return queryOne<Project>(
    `update public.projects set ${sets.join(', ')}
     where organization_id = $1 and id = $2
     returning ${PROJECT_COLUMNS}`,
    params,
  )
}

const TASK_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'blocked', 'review', 'done']

export interface ProjectStatusRollup {
  project_id: string
  counts_by_status: Record<TaskStatus, number>
  total_tasks: number
  overdue_tasks: number
}

/**
 * Roll-up for a single project: task counts by status, plus how many of its open
 * tasks are overdue (due_on in the past and not done).
 */
export async function projectStatus(orgId: string, projectId: string): Promise<ProjectStatusRollup> {
  const counts = await query<{ status: TaskStatus; count: string }>(
    `select status, count(*)::text as count
     from public.tasks
     where organization_id = $1 and project_id = $2
     group by status`,
    [orgId, projectId],
  )
  const overdue = await queryOne<{ count: string }>(
    `select count(*)::text as count
     from public.tasks
     where organization_id = $1 and project_id = $2
       and due_on < current_date and status <> 'done'`,
    [orgId, projectId],
  )

  const counts_by_status = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<
    TaskStatus,
    number
  >
  let total_tasks = 0
  for (const row of counts) {
    const n = Number(row.count)
    counts_by_status[row.status] = n
    total_tasks += n
  }

  return {
    project_id: projectId,
    counts_by_status,
    total_tasks,
    overdue_tasks: Number(overdue?.count ?? 0),
  }
}
