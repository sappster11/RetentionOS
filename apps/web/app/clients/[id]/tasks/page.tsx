import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getClient, listProjects, listTasks, type Task, type TaskStatus, type TaskPriority } from '@retentionos/db'
import { getCurrentOrg } from '@/lib/org'
import {
  Card,
  PriorityBadge,
  Field,
  inputStyle,
  buttonStyle,
  linkStyle,
  formatDateOnly,
  isTaskOverdue,
} from '../../../_components/ui'
import { createTaskAction, updateTaskStatusAction, completeTaskAction } from '@/app/tasks/actions'

const STATUSES: TaskStatus[] = ['todo', 'in_progress', 'blocked', 'review', 'done']

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  blocked: 'Blocked',
  review: 'Review',
  done: 'Done',
}

const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent']

export default async function ClientTasksPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const org = await getCurrentOrg()
  const client = await getClient(org.id, id)
  if (!client) notFound()

  const [projects, tasks] = await Promise.all([
    listProjects(org.id, { clientId: client.id }),
    listTasks(org.id, { clientId: client.id }),
  ])
  const project = projects[0]

  const tasksByStatus: Record<TaskStatus, Task[]> = {
    todo: [],
    in_progress: [],
    blocked: [],
    review: [],
    done: [],
  }
  for (const task of tasks) {
    tasksByStatus[task.status].push(task)
  }

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '3rem 1.5rem' }}>
      <p style={{ marginTop: 0 }}>
        <Link href={`/clients/${client.id}`} style={linkStyle}>
          ← {client.name}
        </Link>
      </p>

      <h1 style={{ fontSize: '1.6rem', margin: 0 }}>{client.name} · Tasks</h1>
      <p style={{ opacity: 0.6, marginTop: '0.25rem' }}>
        {project ? project.name : 'No project yet for this client.'}
      </p>

      <div style={{ overflowX: 'auto', marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '1rem', width: 'max-content' }}>
          {STATUSES.map((status) => (
            <div key={status} style={{ width: 260, flexShrink: 0 }}>
              <Card title={`${STATUS_LABELS[status]} (${tasksByStatus[status].length})`}>
                {tasksByStatus[status].length === 0 ? (
                  <p style={{ opacity: 0.5, fontSize: '0.85rem' }}>No tasks.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {tasksByStatus[status].map((task) => {
                      const overdue = isTaskOverdue(task.due_on, task.status)
                      return (
                        <div
                          key={task.id}
                          style={{
                            background: '#0f1012',
                            border: '1px solid #24262b',
                            borderRadius: 8,
                            padding: '0.6rem 0.7rem',
                          }}
                        >
                          <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.4rem' }}>
                            {task.title}
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              gap: '0.4rem',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              marginBottom: '0.4rem',
                            }}
                          >
                            <PriorityBadge priority={task.priority} />
                            <span style={{ fontSize: '0.75rem', opacity: 0.6 }}>
                              {task.assignee_id ? `Assignee: ${task.assignee_id.slice(0, 8)}` : 'Unassigned'}
                            </span>
                          </div>
                          <div
                            style={{
                              fontSize: '0.75rem',
                              marginBottom: '0.6rem',
                              color: overdue ? '#f08a8a' : undefined,
                              opacity: overdue ? 1 : 0.6,
                            }}
                          >
                            {task.due_on ? `Due ${formatDateOnly(task.due_on)}` : 'No due date'}
                            {overdue ? ' · overdue' : ''}
                          </div>

                          <form
                            action={updateTaskStatusAction}
                            style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.4rem' }}
                          >
                            <input type="hidden" name="task_id" value={task.id} />
                            <select
                              name="status"
                              defaultValue={task.status}
                              style={{ ...inputStyle, padding: '0.3rem 0.4rem', fontSize: '0.75rem', flex: 1 }}
                            >
                              {STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {STATUS_LABELS[s]}
                                </option>
                              ))}
                            </select>
                            <button
                              type="submit"
                              style={{ ...buttonStyle, padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                            >
                              Move
                            </button>
                          </form>

                          {task.status !== 'done' ? (
                            <form action={completeTaskAction}>
                              <input type="hidden" name="task_id" value={task.id} />
                              <button
                                type="submit"
                                style={{
                                  ...buttonStyle,
                                  background: '#1c3a2a',
                                  padding: '0.3rem 0.6rem',
                                  fontSize: '0.75rem',
                                  width: '100%',
                                }}
                              >
                                Complete
                              </button>
                            </form>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                )}
              </Card>
            </div>
          ))}
        </div>
      </div>

      <Card title="New task">
        <form
          action={createTaskAction}
          style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}
        >
          <input type="hidden" name="client_id" value={client.id} />
          {project ? <input type="hidden" name="project_id" value={project.id} /> : null}
          <Field label="Title" style={{ flex: '1 1 220px' }}>
            <input name="title" required style={inputStyle} />
          </Field>
          <Field label="Priority">
            <select name="priority" defaultValue="medium" style={inputStyle}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select name="status" defaultValue="todo" style={inputStyle}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Due date">
            <input name="due_on" type="date" style={inputStyle} />
          </Field>
          <button type="submit" style={buttonStyle}>
            Add task
          </button>
        </form>
      </Card>
    </main>
  )
}
