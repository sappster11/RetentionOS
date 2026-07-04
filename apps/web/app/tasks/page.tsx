import Link from 'next/link'
import { listOverdueTasks, listTasks, listClients, type Task, type TaskStatus } from '@retentionos/db'
import { getCurrentOrg } from '@/lib/org'
import { Card, PriorityBadge, linkStyle, formatDateOnly } from '../_components/ui'

const OPEN_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'blocked', 'review']

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  blocked: 'Blocked',
  review: 'Review',
  done: 'Done',
}

function TaskRow({ task, clientName }: { task: Task; clientName: string }) {
  return (
    <li style={{ padding: '0.5rem 0', borderBottom: '1px solid #24262b' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <strong>{task.title}</strong>
        <PriorityBadge priority={task.priority} />
      </div>
      <div style={{ fontSize: '0.8rem', opacity: 0.6, marginTop: '0.2rem' }}>
        {task.client_id ? (
          <Link href={`/clients/${task.client_id}/tasks`} style={linkStyle}>
            {clientName}
          </Link>
        ) : (
          clientName
        )}
        {task.due_on ? ` · Due ${formatDateOnly(task.due_on)}` : ' · No due date'}
      </div>
    </li>
  )
}

export default async function TasksPage() {
  const org = await getCurrentOrg()
  const [overdueTasks, allTasks, clients] = await Promise.all([
    listOverdueTasks(org.id),
    listTasks(org.id),
    listClients(org.id),
  ])

  const clientNameById = new Map<string, string>()
  for (const client of clients) {
    clientNameById.set(client.id, client.name)
  }
  const clientName = (clientId: string | null): string =>
    (clientId && clientNameById.get(clientId)) || 'Unknown client'

  const openTasks = allTasks.filter((task) => task.status !== 'done')
  const openTasksByStatus: Record<TaskStatus, Task[]> = {
    todo: [],
    in_progress: [],
    blocked: [],
    review: [],
    done: [],
  }
  for (const task of openTasks) {
    openTasksByStatus[task.status].push(task)
  }

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '3rem 1.5rem' }}>
      <p style={{ marginTop: 0 }}>
        <Link href="/clients" style={linkStyle}>
          ← All clients
        </Link>
      </p>

      <h1 style={{ fontSize: '1.6rem', margin: 0 }}>Tasks</h1>
      <p style={{ opacity: 0.6, marginTop: '0.25rem' }}>{org.name}</p>

      <Card title={`Overdue (${overdueTasks.length})`}>
        {overdueTasks.length === 0 ? (
          <p style={{ opacity: 0.6 }}>Nothing overdue.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {overdueTasks.map((task) => (
              <TaskRow key={task.id} task={task} clientName={clientName(task.client_id)} />
            ))}
          </ul>
        )}
      </Card>

      {OPEN_STATUSES.map((status) => {
        const tasksForStatus = openTasksByStatus[status]
        return (
          <Card key={status} title={`${STATUS_LABELS[status]} (${tasksForStatus.length})`}>
            {tasksForStatus.length === 0 ? (
              <p style={{ opacity: 0.6 }}>No tasks in this status.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {tasksForStatus.map((task) => (
                  <TaskRow key={task.id} task={task} clientName={clientName(task.client_id)} />
                ))}
              </ul>
            )}
          </Card>
        )
      })}
    </main>
  )
}
