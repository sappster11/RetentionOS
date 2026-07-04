// Phase 2 PM seed — one project + a handful of tasks per client so the board/list views (and
// mcp-pm once it exists) have something real to render: a mix of statuses and priorities, a
// couple of overdue tasks, a completed task, and a dependency.
//
// Idempotent: if the org already has any projects, this exits without duplicating.
// Deterministic: every date is an offset (in days) from "today", keyed off task index — no
// Math.random(), so the *shape* of the seeded data (which tasks are overdue/done/dependent) is
// always the same.
//
// Run: DATABASE_URL=postgres://... pnpm --filter @retentionos/db seed:pm

import {
  addDependency,
  completeTask,
  createProject,
  createTask,
  getDefaultOrganization,
  listClients,
  listProjects,
} from '../src/index'
import type { Client, ProjectStatus, TaskPriority, TaskStatus } from '../src/index'
import { queryOne } from '../src/pool'

const DAY_MS = 24 * 60 * 60 * 1000

function offsetDate(days: number): string {
  const d = new Date(Date.now() + days * DAY_MS)
  return d.toISOString().slice(0, 10)
}

const PROJECT_STATUSES: ProjectStatus[] = ['active', 'planned', 'on_hold']

interface TaskTemplate {
  title: string
  details: string
  status: TaskStatus
  priority: TaskPriority
  dueOffsetDays: number
  assignToOwner: boolean
  /** Title of another template in this list this task is blocked by, if any. */
  dependsOnTitle?: string
  createdByAgent: boolean
  markComplete: boolean
}

// Six tasks per client, in order: a near-term task, an in-flight one, two overdue-and-not-done
// ones (blocked + in review), one that gets completed after creation, and one agent-proposed
// task that depends on the in-flight one.
const TASK_TEMPLATES: TaskTemplate[] = [
  {
    title: 'Kickoff retention audit',
    details: 'Review lifecycle stage, recent activity, and open risks before planning the quarter.',
    status: 'todo',
    priority: 'high',
    dueOffsetDays: 7,
    assignToOwner: true,
    createdByAgent: false,
    markComplete: false,
  },
  {
    title: 'Draft win-back email sequence',
    details: 'Three-email sequence targeting at-risk segments identified in the last review.',
    status: 'in_progress',
    priority: 'medium',
    dueOffsetDays: 3,
    assignToOwner: false,
    createdByAgent: false,
    markComplete: false,
  },
  {
    title: 'Review churn signals with client',
    details: 'Walk the client through this month’s churn risk cohort before the sequence ships.',
    status: 'blocked',
    priority: 'urgent',
    dueOffsetDays: -4,
    assignToOwner: true,
    createdByAgent: false,
    markComplete: false,
  },
  {
    title: 'Send monthly performance report',
    details: 'Compile the retention/engagement recap and send to the client stakeholder.',
    status: 'review',
    priority: 'low',
    dueOffsetDays: -2,
    assignToOwner: false,
    createdByAgent: false,
    markComplete: false,
  },
  {
    title: 'Publish Q2 retention recap',
    details: 'Quarterly recap doc, shared in the client channel.',
    status: 'todo',
    priority: 'medium',
    dueOffsetDays: -14,
    assignToOwner: false,
    createdByAgent: false,
    markComplete: true,
  },
  {
    title: 'Finalize creative assets for win-back sequence',
    details: 'Agent-proposed follow-up: assets can’t ship until the email sequence draft is done.',
    status: 'todo',
    priority: 'high',
    dueOffsetDays: 14,
    assignToOwner: false,
    dependsOnTitle: 'Draft win-back email sequence',
    createdByAgent: true,
    markComplete: false,
  },
]

async function seedClient(orgId: string, ownerId: string | null, client: Client, projectStatus: ProjectStatus) {
  const project = await createProject(orgId, {
    client_id: client.id,
    name: `${client.name} Retention Program`,
    status: projectStatus,
    owner_id: ownerId ?? undefined,
    starts_on: offsetDate(-30),
    due_on: offsetDate(60),
  })

  const idByTitle = new Map<string, string>()
  for (const t of TASK_TEMPLATES) {
    const task = await createTask(orgId, {
      title: t.title,
      details: t.details,
      project_id: project.id,
      client_id: client.id,
      status: t.status,
      priority: t.priority,
      due_on: offsetDate(t.dueOffsetDays),
      assignee_id: t.assignToOwner ? (ownerId ?? undefined) : undefined,
      created_by_type: t.createdByAgent ? 'agent' : 'user',
      created_by_id: t.createdByAgent ? undefined : (ownerId ?? undefined),
    })
    idByTitle.set(t.title, task.id)

    if (t.markComplete) {
      await completeTask(orgId, task.id)
    }
    const dependsOnId = t.dependsOnTitle ? idByTitle.get(t.dependsOnTitle) : undefined
    if (dependsOnId) {
      await addDependency(orgId, { task_id: task.id, depends_on_task_id: dependsOnId })
    }
  }

  console.log(`  ${client.name}: project "${project.name}" + ${TASK_TEMPLATES.length} tasks.`)
}

async function main() {
  const org = await getDefaultOrganization()
  if (!org) {
    console.error('No organization found — run `pnpm --filter @retentionos/db seed` first.')
    process.exit(1)
  }

  const existingProjects = await listProjects(org.id)
  if (existingProjects.length > 0) {
    console.log(`Org "${org.name}" already has ${existingProjects.length} project(s). Nothing to do.`)
    return
  }

  const clients = await listClients(org.id, { includeArchived: false })
  if (clients.length === 0) {
    console.error('No clients found for org — run `pnpm --filter @retentionos/db seed` first.')
    process.exit(1)
  }

  const owner = await queryOne<{ id: string }>(
    `select u.id
     from public.memberships m
     join public.users u on u.id = m.user_id
     where m.organization_id = $1
     order by (m.role = 'owner') desc, m.created_at asc
     limit 1`,
    [org.id],
  )
  const ownerId = owner?.id ?? null

  console.log(`Seeding PM data for org "${org.name}" (${clients.length} clients)...`)
  for (let i = 0; i < clients.length; i++) {
    const client = clients[i]
    if (!client) continue
    const status = PROJECT_STATUSES[i % PROJECT_STATUSES.length] ?? 'planned'
    await seedClient(org.id, ownerId, client, status)
  }
  console.log('Done.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
