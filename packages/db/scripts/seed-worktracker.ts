// Work Tracker seed — the internal "Asana" as engine configuration (docs/14).
// Base "Ops" 🗂️: Projects + Tasks with kanban board and My-week view.
//
// Run: DATABASE_URL=postgres://... pnpm --filter @retentionos/db seed:worktracker
// Idempotent at the table level (same conventions as seed-contentstudio).

import { getDefaultOrganization } from '../src/index'
import {
  createBase,
  createField,
  createTable,
  createView,
  describeTable,
  getBaseBySlug,
  getTableBySlug,
} from '@retentionos/engine'
import type { Actor, EngineTable } from '@retentionos/engine'

const SEED_ACTOR: Actor = { type: 'user', id: 'seed' }
const created = { tables: 0, fields: 0, views: 0 }
const notes: string[] = []

const sel = (...names: string[]) => ({
  choices: names.map((n) => ({ id: n.toLowerCase().replace(/[^a-z0-9]+/g, '_'), name: n })),
})

type FieldSpec = { name: string; type: string; options?: Record<string, unknown> }

async function ensureLinkField(orgId: string, table: EngineTable, name: string, targetTableId: string) {
  const desc = await describeTable(orgId, table.id)
  if (desc.fields.some((f) => f.name === name)) return
  await createField(
    orgId,
    table.id,
    { name, type: 'linked_record', options: { linkedTableId: targetTableId } },
    SEED_ACTOR,
  )
  created.fields += 1
}

async function ensureOptionalLink(orgId: string, table: EngineTable, name: string, targetSlug: string) {
  const target = await getTableBySlug(orgId, targetSlug)
  if (!target) {
    notes.push(`${table.name}: skipped "${name}" link — no ${targetSlug} table yet (run its seed, then rerun).`)
    return
  }
  await ensureLinkField(orgId, table, name, target.id)
}

async function ensureTable(
  orgId: string,
  baseId: string,
  spec: { name: string; slug: string; icon: string; description: string },
  fields: FieldSpec[],
): Promise<{ table: EngineTable; fieldIds: Record<string, string> }> {
  const existing = await getTableBySlug(orgId, spec.slug)
  if (existing) {
    const desc = await describeTable(orgId, existing.id)
    const fieldIds = Object.fromEntries(desc.fields.map((f) => [f.name, f.id]))
    for (const f of fields) {
      if (fieldIds[f.name]) continue
      const field = await createField(
        orgId,
        existing.id,
        { name: f.name, type: f.type as never, options: f.options as never },
        SEED_ACTOR,
      )
      fieldIds[f.name] = field.id
      created.fields += 1
    }
    return { table: existing, fieldIds }
  }
  const table = await createTable(
    orgId,
    { name: spec.name, icon: spec.icon, description: spec.description, baseId },
    SEED_ACTOR,
  )
  created.tables += 1
  const fieldIds: Record<string, string> = {}
  for (const f of fields) {
    const field = await createField(
      orgId,
      table.id,
      { name: f.name, type: f.type as never, options: f.options as never },
      SEED_ACTOR,
    )
    fieldIds[f.name] = field.id
    created.fields += 1
  }
  await createView(orgId, table.id, { name: 'Grid', type: 'grid' })
  created.views += 1
  return { table, fieldIds }
}

async function ensureView(
  orgId: string,
  tableId: string,
  name: string,
  type: 'grid' | 'kanban',
  config: Record<string, unknown>,
) {
  const { views } = await describeTable(orgId, tableId)
  if (views.some((v) => v.name === name)) return
  await createView(orgId, tableId, { name, type, config: config as never })
  created.views += 1
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.')
  const org = await getDefaultOrganization()
  if (!org) throw new Error('No organization exists — run seed:engine first.')
  const orgId = org.id

  const base =
    (await getBaseBySlug(orgId, 'ops')) ??
    (await createBase(orgId, { name: 'Ops', icon: '🗂️' }, SEED_ACTOR))

  const projects = await ensureTable(
    orgId,
    base.id,
    { name: 'Projects', slug: 'projects', icon: '📂', description: 'Bodies of work, internal or per client.' },
    [
      { name: 'Project', type: 'text' },
      { name: 'Status', type: 'single_select', options: sel('Active', 'On Hold', 'Done') },
      { name: 'Due', type: 'date' },
      { name: 'Notes', type: 'long_text' },
    ],
  )
  await ensureOptionalLink(orgId, projects.table, 'Client', 'clients')

  const tasks = await ensureTable(
    orgId,
    base.id,
    { name: 'Tasks', slug: 'tasks', icon: '✅', description: 'The unit of internal work. Board view = the daily driver.' },
    [
      { name: 'Task', type: 'text' },
      {
        name: 'Status',
        type: 'single_select',
        options: sel('Backlog', 'To Do', 'In Progress', 'In Review', 'Done'),
      },
      { name: 'Priority', type: 'single_select', options: sel('Low', 'Medium', 'High', 'Urgent') },
      { name: 'Due', type: 'date' },
      { name: 'Notes', type: 'long_text' },
    ],
  )
  await ensureLinkField(orgId, tasks.table, 'Project', projects.table.id)
  await ensureOptionalLink(orgId, tasks.table, 'Client', 'clients')
  await ensureOptionalLink(orgId, tasks.table, 'Assignee', 'team-members')
  await ensureOptionalLink(orgId, tasks.table, 'Related Brief', 'send-briefs')

  const statusId = tasks.fieldIds['Status']!
  const dueId = tasks.fieldIds['Due']!
  await ensureView(orgId, tasks.table.id, 'Board', 'kanban', { groupByFieldId: statusId })
  await ensureView(orgId, tasks.table.id, 'My week', 'grid', {
    filters: [
      { fieldId: dueId, op: 'on_or_before_today' },
      { fieldId: statusId, op: 'neq', value: 'done' },
    ],
    sorts: [{ fieldId: dueId, direction: 'asc' }],
  })

  console.log(
    `Work Tracker seed complete: ${created.tables} tables, ${created.fields} fields, ${created.views} views created.`,
  )
  for (const n of notes) console.log(`note: ${n}`)
  if (created.tables + created.fields + created.views === 0) {
    console.log('Everything already present — nothing to do (idempotent re-run).')
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err?.message ?? err)
    process.exit(1)
  },
)
