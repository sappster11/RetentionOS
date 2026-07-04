#!/usr/bin/env tsx
// PM MCP server — the "works with any model" layer (docs/04-ai-and-agent-layer.md).
//
// Exposes the agentic project-management tool surface (list/get/create/update tasks,
// assignment, completion, comments, dependencies, and project rollups) over stdio, backed
// by @retentionos/db — the SAME data-access layer the web app uses. So the same tools work
// from Claude Desktop/Code and from an OpenAI Agents-SDK caller, against the same owned
// Postgres.
//
// Tenant-safety: this server talks to Postgres directly (no RLS), so it MUST scope every
// query by organization_id itself. It never becomes a backdoor around tenancy — every
// tool resolves its org via resolveOrg() before touching the database.

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  getDefaultOrganization,
  listTasks,
  getTask,
  createTask,
  updateTask,
  assignTask,
  completeTask,
  listOverdueTasks,
  addTaskComment,
  listTaskComments,
  addDependency,
  listProjects,
  getProject,
  projectStatus,
  logActivity,
} from '@retentionos/db'
import { z } from 'zod'

// The org this server operates within. In-app runtime derives this from the authed
// session; for the stdio server it's provided by env (or per-tool override).
const DEFAULT_ORG_ID = process.env.RETENTIONOS_ORG_ID

if (!process.env.DATABASE_URL) {
  // @retentionos/db's connection pool throws lazily on first query if this is unset —
  // fail fast here instead, with a message that points at the fix.
  console.error('Missing DATABASE_URL. See .env.example / docs/LOCAL_DEV.md.')
  process.exit(1)
}

/**
 * Resolve the organization to scope a tool call to: an explicit per-call override, else
 * the server-wide RETENTIONOS_ORG_ID, else the first (only, in dev) organization in the
 * database. Throws if none of those resolve — every tool must call this before touching
 * the database, so tenant scoping is never accidentally skipped.
 */
async function resolveOrg(inputOrgId?: string): Promise<string> {
  if (inputOrgId) return inputOrgId
  if (DEFAULT_ORG_ID) return DEFAULT_ORG_ID
  const org = await getDefaultOrganization()
  if (org?.id) return org.id
  throw new Error(
    'No organization_id provided, RETENTIONOS_ORG_ID is not set, and no organization exists.',
  )
}

function ok(result: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return { isError: true, content: [{ type: 'text' as const, text: message }] }
}

const organizationIdField = z
  .string()
  .uuid()
  .optional()
  .describe(
    'Organization to scope to. Defaults to the server RETENTIONOS_ORG_ID, then the ' +
      'first organization in the database. Only pass this if you need to target a ' +
      'specific tenant explicitly.',
  )

const clientIdField = z.string().uuid().describe('The client account id (UUID).')
const taskIdField = z.string().uuid().describe('The task id (UUID).')

const statusField = z
  .enum(['todo', 'in_progress', 'blocked', 'review', 'done'])
  .describe('Task status.')

const priorityField = z.enum(['low', 'medium', 'high', 'urgent']).describe('Task priority.')

const dueOnField = z.string().describe('Due date, as YYYY-MM-DD.')

const server = new McpServer({
  name: 'retentionos-pm',
  version: '0.1.0',
})

server.registerTool(
  'list_tasks',
  {
    title: 'List tasks',
    description:
      'List tasks for an organization, optionally filtered by client, project, assignee, ' +
      'status, or overdue-only. Returns each task with id, title, status, priority, ' +
      'assignee_id, due_on, and completed_at. Use this to browse the task backlog; use ' +
      'list_overdue_tasks for a cross-client "what\'s late" view.',
    inputSchema: {
      client_id: z.string().uuid().optional().describe('Filter to tasks for this client.'),
      project_id: z.string().uuid().optional().describe('Filter to tasks in this project.'),
      assignee_id: z.string().uuid().optional().describe('Filter to tasks assigned to this id.'),
      status: statusField.optional().describe('Filter to tasks with this status.'),
      overdue_only: z
        .boolean()
        .optional()
        .describe('If true, only return open tasks past their due_on date.'),
      limit: z.number().int().min(1).max(200).optional().describe('Max rows (default 50).'),
      organization_id: organizationIdField,
    },
  },
  async ({ client_id, project_id, assignee_id, status, overdue_only, limit, organization_id }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const tasks = await listTasks(orgId, {
        clientId: client_id,
        projectId: project_id,
        assigneeId: assignee_id,
        status,
        overdueOnly: overdue_only,
        limit: limit ?? 50,
      })
      return ok({ tasks })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'get_task',
  {
    title: 'Get task',
    description:
      'Fetch a single task by id, including status, priority, assignee_id, due_on, ' +
      'completed_at, and its comment thread. Reports if no task with that id exists in ' +
      'the organization.',
    inputSchema: {
      task_id: taskIdField,
      organization_id: organizationIdField,
    },
  },
  async ({ task_id, organization_id }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const task = await getTask(orgId, task_id)
      if (!task) return ok({ found: false, message: `No task found with id ${task_id}.` })
      const comments = await listTaskComments(orgId, task_id)
      return ok({ found: true, task, comments })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'list_overdue_tasks',
  {
    title: 'List overdue tasks',
    description:
      'List every open (not done), past-due task across all clients in the organization, ' +
      'soonest-overdue first. Use this to answer "what\'s late right now" without having ' +
      'to filter by client first.',
    inputSchema: {
      limit: z.number().int().min(1).max(200).optional().describe('Max rows (default 50).'),
      organization_id: organizationIdField,
    },
  },
  async ({ limit, organization_id }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const tasks = await listOverdueTasks(orgId, { limit: limit ?? 50 })
      return ok({ tasks })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'create_task',
  {
    title: 'Create task',
    description:
      'Create a new task, optionally under a project and/or client. Only `title` is ' +
      'required; status defaults to "todo" and priority defaults to "medium". Marks the ' +
      'task as created_by_type "agent" and logs a task.created activity.',
    inputSchema: {
      title: z.string().min(1).describe('Task title.'),
      project_id: z.string().uuid().optional().describe('Project this task belongs to.'),
      client_id: z.string().uuid().optional().describe('Client this task is for.'),
      details: z.string().optional().describe('Longer freeform description of the task.'),
      status: statusField.optional().describe('Initial status. Defaults to "todo".'),
      priority: priorityField.optional().describe('Initial priority. Defaults to "medium".'),
      assignee_id: z.string().uuid().optional().describe('User/agent id to assign the task to.'),
      due_on: dueOnField.optional(),
      organization_id: organizationIdField,
    },
  },
  async ({
    title,
    project_id,
    client_id,
    details,
    status,
    priority,
    assignee_id,
    due_on,
    organization_id,
  }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const task = await createTask(orgId, {
        title,
        project_id,
        client_id,
        details,
        status,
        priority,
        assignee_id,
        due_on,
        created_by_type: 'agent',
      })
      await logActivity(orgId, {
        client_id: task.client_id,
        actor_type: 'agent',
        verb: 'task.created',
        summary: `Created task "${task.title}"`,
        data: { task_id: task.id, title, project_id, status, priority, assignee_id, due_on },
      })
      return ok({ task })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'update_task',
  {
    title: 'Update task',
    description:
      'Update fields on an existing task (status, priority, title, details, due_on). Only ' +
      'the fields you provide are changed; omitted fields are left as-is. Logs a ' +
      'task.updated activity with the changed fields.',
    inputSchema: {
      task_id: taskIdField,
      status: statusField.optional().describe('New status.'),
      priority: priorityField.optional().describe('New priority.'),
      title: z.string().min(1).optional().describe('New title.'),
      details: z.string().optional().describe('New description.'),
      due_on: dueOnField.optional(),
      organization_id: organizationIdField,
    },
  },
  async ({ task_id, status, priority, title, details, due_on, organization_id }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const existing = await getTask(orgId, task_id)
      if (!existing) return fail(new Error(`No task found with id ${task_id}.`))

      const patch: Record<string, unknown> = {}
      if (status !== undefined) patch.status = status
      if (priority !== undefined) patch.priority = priority
      if (title !== undefined) patch.title = title
      if (details !== undefined) patch.details = details
      if (due_on !== undefined) patch.due_on = due_on

      const task = await updateTask(orgId, task_id, patch)
      if (!task) return fail(new Error(`No task found with id ${task_id}.`))

      await logActivity(orgId, {
        client_id: existing.client_id,
        actor_type: 'agent',
        verb: 'task.updated',
        summary: `Updated task "${existing.title}"`,
        data: patch,
      })
      return ok({ task })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'assign_task',
  {
    title: 'Assign task',
    description: 'Assign a task to a user/agent id. Logs a task.assigned activity.',
    inputSchema: {
      task_id: taskIdField,
      assignee_id: z.string().uuid().describe('User/agent id to assign the task to.'),
      organization_id: organizationIdField,
    },
  },
  async ({ task_id, assignee_id, organization_id }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const existing = await getTask(orgId, task_id)
      if (!existing) return fail(new Error(`No task found with id ${task_id}.`))

      const task = await assignTask(orgId, task_id, assignee_id)
      if (!task) return fail(new Error(`No task found with id ${task_id}.`))

      await logActivity(orgId, {
        client_id: existing.client_id,
        actor_type: 'agent',
        verb: 'task.assigned',
        summary: `Assigned task "${existing.title}"`,
        data: { assignee_id },
      })
      return ok({ task })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'complete_task',
  {
    title: 'Complete task',
    description:
      'Mark a task done (sets status to "done" and stamps completed_at). Logs a ' +
      'task.completed activity.',
    inputSchema: {
      task_id: taskIdField,
      organization_id: organizationIdField,
    },
  },
  async ({ task_id, organization_id }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const existing = await getTask(orgId, task_id)
      if (!existing) return fail(new Error(`No task found with id ${task_id}.`))

      const task = await completeTask(orgId, task_id)
      if (!task) return fail(new Error(`No task found with id ${task_id}.`))

      await logActivity(orgId, {
        client_id: existing.client_id,
        actor_type: 'agent',
        verb: 'task.completed',
        summary: `Completed task "${existing.title}"`,
        data: { task_id },
      })
      return ok({ task })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'add_comment',
  {
    title: 'Add comment',
    description:
      'Add a comment to a task (e.g. a status update or note for a human). Marks the ' +
      'comment as author_type "agent" and logs a task.commented activity.',
    inputSchema: {
      task_id: taskIdField,
      body: z.string().min(1).describe('Comment text.'),
      organization_id: organizationIdField,
    },
  },
  async ({ task_id, body, organization_id }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const existing = await getTask(orgId, task_id)
      if (!existing) return fail(new Error(`No task found with id ${task_id}.`))

      const comment = await addTaskComment(orgId, { task_id, author_type: 'agent', body })
      await logActivity(orgId, {
        client_id: existing.client_id,
        actor_type: 'agent',
        verb: 'task.commented',
        summary: `Commented on task "${existing.title}"`,
        data: { comment_id: comment.id, body },
      })
      return ok({ comment })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'add_dependency',
  {
    title: 'Add dependency',
    description:
      'Record that a task depends on another task (it should not proceed until the other ' +
      'is done). Logs a task.dependency_added activity.',
    inputSchema: {
      task_id: taskIdField,
      depends_on_task_id: z.string().uuid().describe('The task id this task depends on.'),
      organization_id: organizationIdField,
    },
  },
  async ({ task_id, depends_on_task_id, organization_id }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const existing = await getTask(orgId, task_id)
      if (!existing) return fail(new Error(`No task found with id ${task_id}.`))

      const dependency = await addDependency(orgId, { task_id, depends_on_task_id })
      await logActivity(orgId, {
        client_id: existing.client_id,
        actor_type: 'agent',
        verb: 'task.dependency_added',
        summary: `Added dependency on task ${depends_on_task_id} to "${existing.title}"`,
        data: { depends_on_task_id },
      })
      return ok({ dependency })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'list_projects',
  {
    title: 'List projects',
    description:
      'List projects for an organization, optionally filtered by client. Returns each ' +
      'project with id, name, status, owner_id, starts_on, and due_on.',
    inputSchema: {
      client_id: clientIdField.optional(),
      organization_id: organizationIdField,
    },
  },
  async ({ client_id, organization_id }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const projects = await listProjects(orgId, { clientId: client_id })
      return ok({ projects })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'project_status',
  {
    title: 'Project status',
    description:
      'Roll up a project\'s tasks: counts by status (todo/in_progress/blocked/review/done), ' +
      'total task count, and how many open tasks are overdue. Use this for a quick ' +
      '"how is this project doing" summary.',
    inputSchema: {
      project_id: z.string().uuid().describe('The project id (UUID).'),
      organization_id: organizationIdField,
    },
  },
  async ({ project_id, organization_id }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const rollup = await projectStatus(orgId, project_id)
      return ok({ rollup })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerResource(
  'task',
  new ResourceTemplate('task://{id}', { list: undefined }),
  {
    title: 'Task',
    description:
      'A single task, as JSON. Resolve the org via the server default ' +
      '(RETENTIONOS_ORG_ID) — this resource does not take an organization override.',
    mimeType: 'application/json',
  },
  async (uri, { id }) => {
    const taskId = Array.isArray(id) ? id[0] : id
    if (!taskId) throw new Error('task:// resource requires a non-empty id.')
    const orgId = await resolveOrg()
    const task = await getTask(orgId, taskId)
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(task ?? { found: false, message: `No task found with id ${taskId}.` }, null, 2),
        },
      ],
    }
  },
)

server.registerResource(
  'project',
  new ResourceTemplate('project://{id}', { list: undefined }),
  {
    title: 'Project',
    description:
      'A single project, as JSON. Resolve the org via the server default ' +
      '(RETENTIONOS_ORG_ID) — this resource does not take an organization override.',
    mimeType: 'application/json',
  },
  async (uri, { id }) => {
    const projectId = Array.isArray(id) ? id[0] : id
    if (!projectId) throw new Error('project:// resource requires a non-empty id.')
    const orgId = await resolveOrg()
    const project = await getProject(orgId, projectId)
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(
            project ?? { found: false, message: `No project found with id ${projectId}.` },
            null,
            2,
          ),
        },
      ],
    }
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
console.error('retentionos-pm MCP server running on stdio')
