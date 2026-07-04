import type { CSSProperties, ReactNode } from 'react'
import type { ClientStatus, TaskPriority, TaskStatus } from '@retentionos/db'

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section
      style={{
        background: '#141518',
        border: '1px solid #24262b',
        borderRadius: 10,
        padding: '1.25rem',
        marginBottom: '1.25rem',
      }}
    >
      {title ? (
        <h2
          style={{
            fontSize: '0.85rem',
            textTransform: 'uppercase',
            letterSpacing: 1,
            opacity: 0.6,
            margin: '0 0 0.9rem 0',
          }}
        >
          {title}
        </h2>
      ) : null}
      {children}
    </section>
  )
}

const STATUS_COLORS: Record<ClientStatus, { bg: string; fg: string }> = {
  prospect: { bg: '#2a2a3a', fg: '#b8b8ff' },
  onboarding: { bg: '#2a3320', fg: '#c8e6a0' },
  active: { bg: '#173a2a', fg: '#7fe0ab' },
  at_risk: { bg: '#3a2a17', fg: '#f0b16a' },
  churned: { bg: '#3a1717', fg: '#f08a8a' },
  paused: { bg: '#2a2a2a', fg: '#c0c0c0' },
}

export function StatusBadge({ status }: { status: ClientStatus }) {
  const colors = STATUS_COLORS[status]
  return (
    <span
      style={{
        display: 'inline-block',
        background: colors.bg,
        color: colors.fg,
        borderRadius: 999,
        padding: '0.15rem 0.65rem',
        fontSize: '0.75rem',
        fontWeight: 600,
        textTransform: 'capitalize',
        whiteSpace: 'nowrap',
      }}
    >
      {status.replace('_', ' ')}
    </span>
  )
}

const PRIORITY_COLORS: Record<TaskPriority, { bg: string; fg: string }> = {
  low: { bg: '#20242a', fg: '#9aa6b2' },
  medium: { bg: '#1c2a3a', fg: '#7fb0ff' },
  high: { bg: '#3a2a17', fg: '#f0b16a' },
  urgent: { bg: '#3a1717', fg: '#f08a8a' },
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const colors = PRIORITY_COLORS[priority]
  return (
    <span
      style={{
        display: 'inline-block',
        background: colors.bg,
        color: colors.fg,
        borderRadius: 999,
        padding: '0.15rem 0.65rem',
        fontSize: '0.7rem',
        fontWeight: 600,
        textTransform: 'capitalize',
        whiteSpace: 'nowrap',
      }}
    >
      {priority}
    </span>
  )
}

export function Field({
  label,
  children,
  style,
}: {
  label: string
  children: ReactNode
  style?: CSSProperties
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', ...style }}>
      <span style={{ fontSize: '0.75rem', opacity: 0.6 }}>{label}</span>
      {children}
    </label>
  )
}

export const inputStyle: CSSProperties = {
  background: '#0f1012',
  border: '1px solid #2c2e33',
  borderRadius: 6,
  color: '#e7e9ee',
  padding: '0.45rem 0.6rem',
  fontSize: '0.9rem',
  fontFamily: 'inherit',
}

export const buttonStyle: CSSProperties = {
  background: '#2a5bd7',
  border: 'none',
  borderRadius: 6,
  color: '#fff',
  padding: '0.5rem 1rem',
  fontSize: '0.85rem',
  fontWeight: 600,
  cursor: 'pointer',
}

export const linkStyle: CSSProperties = {
  color: '#7fb0ff',
  textDecoration: 'none',
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Formats a date-only field (e.g. `due_on`, `starts_on`) without shifting timezones.
 * The db layer types these as `string`, but the underlying `date` columns come back
 * from `pg` as `Date` objects at runtime — `new Date(value)` tolerates either shape.
 */
export function formatDateOnly(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/** A task is overdue if it has a due date in the past and hasn't been completed. */
export function isTaskOverdue(dueOn: string | null, status: TaskStatus): boolean {
  if (!dueOn || status === 'done') return false
  const due = new Date(dueOn)
  if (Number.isNaN(due.getTime())) return false
  const todayKey = new Date().toISOString().slice(0, 10)
  const dueKey = due.toISOString().slice(0, 10)
  return dueKey < todayKey
}
