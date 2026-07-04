import { query, queryOne } from './pool'
import type { ActorType, Task, TaskComment, TaskDependency, TaskPriority, TaskStatus } from './types'

const TASK_COLUMNS = `
  id, organization_id, project_id, client_id, title, details, status, priority,
  assignee_id, due_on, completed_at, created_by_type, created_by_id, metadata,
  created_at, updated_at
`

const TASK_COMMENT_COLUMNS = `
  id, organization_id, task_id, author_type, author_id, body, created_at
`

const TASK_DEPENDENCY_COLUMNS = `
  id, organization_id, task_id, depends_on_task_id, created_at
`

export interface ListTasksOptions {
  clientId?: string
  projectId?: string
  assigneeId?: string
  status?: TaskStatus
  overdueOnly?: boolean
  limit?: number
}

/** Tenant-scoped: always filtered by organization_id. */
export async function listTasks(orgId: string, opts: ListTasksOptions = {}): Promise<Task[]> {
  const params: unknown[] = [orgId]
  let sql = `select ${TASK_COLUMNS} from public.tasks where organization_id = $1`
  if (opts.clientId) {
    params.push(opts.clientId)
    sql += ` and client_id = $${params.length}`
  }
  if (opts.projectId) {
    params.push(opts.projectId)
    sql += ` and project_id = $${params.length}`
  }
  if (opts.assigneeId) {
    params.push(opts.assigneeId)
    sql += ` and assignee_id = $${params.length}`
  }
  if (opts.status) {
    params.push(opts.status)
    sql += ` and status = $${params.length}`
  }
  if (opts.overdueOnly) {
    sql += ` and due_on < current_date and status <> 'done'`
  }
  sql += ' order by due_on asc nulls last, priority desc, created_at asc'
  if (opts.limit) {
    params.push(opts.limit)
    sql += ` limit $${params.length}`
  }
  return query<Task>(sql, params)
}

export async function getTask(orgId: string, id: string): Promise<Task | null> {
  return queryOne<Task>(
    `select ${TASK_COLUMNS} from public.tasks where organization_id = $1 and id = $2`,
    [orgId, id],
  )
}

export interface CreateTaskInput {
  title: string
  project_id?: string
  client_id?: string
  details?: string
  status?: TaskStatus
  priority?: TaskPriority
  assignee_id?: string
  due_on?: string
  created_by_type?: ActorType
  created_by_id?: string
}

export async function createTask(orgId: string, input: CreateTaskInput): Promise<Task> {
  const row = await queryOne<Task>(
    `insert into public.tasks
       (organization_id, project_id, client_id, title, details, status, priority,
        assignee_id, due_on, created_by_type, created_by_id)
     values ($1, $2, $3, $4, $5,
             coalesce($6::public.task_status, 'todo'),
             coalesce($7::public.task_priority, 'medium'),
             $8, $9,
             coalesce($10::public.actor_type, 'user'),
             $11)
     returning ${TASK_COLUMNS}`,
    [
      orgId,
      input.project_id ?? null,
      input.client_id ?? null,
      input.title,
      input.details ?? null,
      input.status ?? null,
      input.priority ?? null,
      input.assignee_id ?? null,
      input.due_on ?? null,
      input.created_by_type ?? null,
      input.created_by_id ?? null,
    ],
  )
  if (!row) throw new Error('Failed to create task')
  return row
}

export interface UpdateTaskPatch {
  title?: string
  details?: string | null
  status?: TaskStatus
  priority?: TaskPriority
  assignee_id?: string | null
  due_on?: string | null
  project_id?: string | null
  client_id?: string | null
  metadata?: Record<string, unknown>
}

export async function updateTask(
  orgId: string,
  id: string,
  patch: UpdateTaskPatch,
): Promise<Task | null> {
  const fields = Object.keys(patch) as Array<keyof UpdateTaskPatch>
  if (fields.length === 0) return getTask(orgId, id)

  // Enum columns need an explicit cast — a bound text param won't assign to an enum.
  const enumCasts: Partial<Record<keyof UpdateTaskPatch, string>> = {
    status: 'public.task_status',
    priority: 'public.task_priority',
  }

  const sets: string[] = []
  const params: unknown[] = [orgId, id]
  for (const field of fields) {
    const value = patch[field]
    params.push(field === 'metadata' ? JSON.stringify(value) : value)
    const cast = enumCasts[field]
    sets.push(`${field} = $${params.length}${cast ? `::${cast}` : ''}`)
  }
  // Completing a task stamps completed_at; moving it to any other status clears the stamp.
  if (patch.status === 'done') {
    sets.push('completed_at = now()')
  } else if (patch.status) {
    sets.push('completed_at = null')
  }

  return queryOne<Task>(
    `update public.tasks set ${sets.join(', ')}
     where organization_id = $1 and id = $2
     returning ${TASK_COLUMNS}`,
    params,
  )
}

export async function assignTask(orgId: string, id: string, assigneeId: string | null): Promise<Task | null> {
  return updateTask(orgId, id, { assignee_id: assigneeId })
}

export async function completeTask(orgId: string, id: string): Promise<Task | null> {
  return updateTask(orgId, id, { status: 'done' })
}

export interface ListOverdueTasksOptions {
  limit?: number
}

/** Cross-client: every open, past-due task in the organization. */
export async function listOverdueTasks(
  orgId: string,
  opts: ListOverdueTasksOptions = {},
): Promise<Task[]> {
  const params: unknown[] = [orgId]
  let sql = `select ${TASK_COLUMNS} from public.tasks
     where organization_id = $1 and due_on < current_date and status <> 'done'
     order by due_on asc`
  if (opts.limit) {
    params.push(opts.limit)
    sql += ` limit $${params.length}`
  }
  return query<Task>(sql, params)
}

export interface AddTaskCommentInput {
  task_id: string
  author_type?: ActorType
  author_id?: string
  body: string
}

export async function addTaskComment(orgId: string, input: AddTaskCommentInput): Promise<TaskComment> {
  const row = await queryOne<TaskComment>(
    `insert into public.task_comments
       (organization_id, task_id, author_type, author_id, body)
     values ($1, $2, coalesce($3::public.actor_type, 'user'), $4, $5)
     returning ${TASK_COMMENT_COLUMNS}`,
    [orgId, input.task_id, input.author_type ?? null, input.author_id ?? null, input.body],
  )
  if (!row) throw new Error('Failed to add task comment')
  return row
}

export async function listTaskComments(orgId: string, taskId: string): Promise<TaskComment[]> {
  return query<TaskComment>(
    `select ${TASK_COMMENT_COLUMNS} from public.task_comments
     where organization_id = $1 and task_id = $2
     order by created_at asc`,
    [orgId, taskId],
  )
}

export interface AddDependencyInput {
  task_id: string
  depends_on_task_id: string
}

export async function addDependency(
  orgId: string,
  input: AddDependencyInput,
): Promise<TaskDependency> {
  const row = await queryOne<TaskDependency>(
    `insert into public.task_dependencies (organization_id, task_id, depends_on_task_id)
     values ($1, $2, $3)
     returning ${TASK_DEPENDENCY_COLUMNS}`,
    [orgId, input.task_id, input.depends_on_task_id],
  )
  if (!row) throw new Error('Failed to add task dependency')
  return row
}
