'use server'

import { revalidatePath } from 'next/cache'
import {
  createTask,
  updateTask,
  completeTask,
  assignTask,
  logActivity,
  getTask,
  type TaskStatus,
  type TaskPriority,
} from '@retentionos/db'
import { getCurrentOrg } from '@/lib/org'

function requireString(formData: FormData, field: string): string {
  const value = formData.get(field)
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required field: ${field}`)
  }
  return value.trim()
}

function optionalString(formData: FormData, field: string): string | undefined {
  const value = formData.get(field)
  if (typeof value !== 'string' || value.trim() === '') return undefined
  return value.trim()
}

export async function createTaskAction(formData: FormData): Promise<void> {
  const org = await getCurrentOrg()
  const title = requireString(formData, 'title')
  const clientId = optionalString(formData, 'client_id')
  const projectId = optionalString(formData, 'project_id')
  const priority = optionalString(formData, 'priority') as TaskPriority | undefined
  const status = optionalString(formData, 'status') as TaskStatus | undefined
  const dueOn = optionalString(formData, 'due_on')

  const task = await createTask(org.id, {
    title,
    client_id: clientId,
    project_id: projectId,
    priority,
    status,
    due_on: dueOn,
  })
  await logActivity(org.id, {
    client_id: task.client_id,
    verb: 'task.created',
    summary: `Task "${task.title}" was created`,
    data: { task_id: task.id, status: task.status, priority: task.priority },
  })

  if (task.client_id) revalidatePath(`/clients/${task.client_id}/tasks`)
  revalidatePath('/tasks')
}

export async function updateTaskStatusAction(formData: FormData): Promise<void> {
  const org = await getCurrentOrg()
  const taskId = requireString(formData, 'task_id')
  const nextStatus = requireString(formData, 'status') as TaskStatus

  const before = await getTask(org.id, taskId)
  if (!before) throw new Error('Task not found')

  const task = await updateTask(org.id, taskId, { status: nextStatus })
  if (!task) throw new Error('Task not found')

  await logActivity(org.id, {
    client_id: task.client_id,
    verb: 'task.status_changed',
    summary: `Task "${task.title}" moved from ${before.status} to ${nextStatus}`,
    data: { task_id: task.id, from: before.status, to: nextStatus },
  })

  if (task.client_id) revalidatePath(`/clients/${task.client_id}/tasks`)
  revalidatePath('/tasks')
}

export async function completeTaskAction(formData: FormData): Promise<void> {
  const org = await getCurrentOrg()
  const taskId = requireString(formData, 'task_id')

  const task = await completeTask(org.id, taskId)
  if (!task) throw new Error('Task not found')

  await logActivity(org.id, {
    client_id: task.client_id,
    verb: 'task.completed',
    summary: `Task "${task.title}" was completed`,
    data: { task_id: task.id },
  })

  if (task.client_id) revalidatePath(`/clients/${task.client_id}/tasks`)
  revalidatePath('/tasks')
}

export async function assignTaskAction(formData: FormData): Promise<void> {
  const org = await getCurrentOrg()
  const taskId = requireString(formData, 'task_id')
  const assigneeId = optionalString(formData, 'assignee_id') ?? null

  const task = await assignTask(org.id, taskId, assigneeId)
  if (!task) throw new Error('Task not found')

  await logActivity(org.id, {
    client_id: task.client_id,
    verb: 'task.assigned',
    summary: assigneeId ? `Task "${task.title}" was assigned` : `Task "${task.title}" was unassigned`,
    data: { task_id: task.id, assignee_id: assigneeId },
  })

  if (task.client_id) revalidatePath(`/clients/${task.client_id}/tasks`)
  revalidatePath('/tasks')
}
