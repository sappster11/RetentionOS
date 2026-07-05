// Engine seed — one example table ("Getting Started") with fields covering several
// Phase-A types and a few records, so the app isn't empty on first run. Idempotent: if the
// table already exists in the org it exits without duplicating.
//
// Run: DATABASE_URL=postgres://... pnpm --filter @retentionos/db seed:engine
//
// Requires an organization to exist (run `pnpm --filter @retentionos/db seed` first, or
// this script creates a stand-in org). Uses @retentionos/engine — the same service layer
// the UI and API call — so the seeded data is created exactly as a user/agent would.

import { getDefaultOrganization } from '../src/index'
import { query, queryOne } from '../src/pool'
import {
  createField,
  createRecord,
  createView,
  getTableBySlug,
  createTable,
} from '@retentionos/engine'
import type { Actor } from '@retentionos/engine'

const SEED_ACTOR: Actor = { type: 'user', id: 'seed' }

async function ensureOrgId(): Promise<string> {
  const org = await getDefaultOrganization()
  if (org) return org.id
  const row = await queryOne<{ id: string }>(
    `insert into public.organizations (name, slug) values ($1, $2) returning id`,
    ['Roam', 'roam'],
  )
  if (!row) throw new Error('Failed to create stand-in organization')
  return row.id
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.')
  const orgId = await ensureOrgId()

  const existing = await getTableBySlug(orgId, 'getting-started')
  if (existing) {
    console.log(`Engine seed already present (table ${existing.id}). Nothing to do.`)
    return
  }

  const table = await createTable(
    orgId,
    {
      name: 'Getting Started',
      icon: '🚀',
      description: 'A sample table showing off Phase-A field types.',
    },
    SEED_ACTOR,
  )

  const nameF = await createField(orgId, table.id, { name: 'Task', type: 'text', required: true }, SEED_ACTOR)
  const notesF = await createField(orgId, table.id, { name: 'Notes', type: 'long_text' }, SEED_ACTOR)
  const statusF = await createField(
    orgId,
    table.id,
    {
      name: 'Status',
      type: 'single_select',
      options: {
        choices: [
          { id: 'todo', name: 'To do', color: 'gray' },
          { id: 'doing', name: 'In progress', color: 'blue' },
          { id: 'done', name: 'Done', color: 'green' },
        ],
      },
    },
    SEED_ACTOR,
  )
  const tagsF = await createField(
    orgId,
    table.id,
    {
      name: 'Tags',
      type: 'multi_select',
      options: {
        choices: [
          { id: 'setup', name: 'setup', color: 'purple' },
          { id: 'data', name: 'data', color: 'orange' },
          { id: 'ui', name: 'ui', color: 'yellow' },
        ],
      },
    },
    SEED_ACTOR,
  )
  const priorityF = await createField(orgId, table.id, { name: 'Priority', type: 'number' }, SEED_ACTOR)
  const budgetF = await createField(
    orgId,
    table.id,
    { name: 'Budget', type: 'currency', options: { currencySymbol: '$' } },
    SEED_ACTOR,
  )
  const doneF = await createField(orgId, table.id, { name: 'Approved', type: 'checkbox' }, SEED_ACTOR)
  const dueF = await createField(orgId, table.id, { name: 'Due', type: 'date' }, SEED_ACTOR)
  const linkF = await createField(orgId, table.id, { name: 'Link', type: 'url' }, SEED_ACTOR)

  await createView(orgId, table.id, { name: 'Grid', type: 'grid' })

  const rows: Array<Record<string, unknown>> = [
    {
      [nameF.id]: 'Create your first table',
      [notesF.id]: 'You just did — this is it. Add fields with the + column header.',
      [statusF.id]: 'done',
      [tagsF.id]: ['setup'],
      [priorityF.id]: 1,
      [budgetF.id]: 0,
      [doneF.id]: true,
      [dueF.id]: '2026-07-01',
      [linkF.id]: 'https://airtable.com',
    },
    {
      [nameF.id]: 'Add records in the grid',
      [notesF.id]: 'Click a cell to edit inline; use the + Add row button at the bottom.',
      [statusF.id]: 'doing',
      [tagsF.id]: ['data', 'ui'],
      [priorityF.id]: 2,
      [budgetF.id]: 1200.5,
      [doneF.id]: false,
      [dueF.id]: '2026-07-10',
    },
    {
      [nameF.id]: 'Try it via the API',
      [notesF.id]: 'Everything the UI does is a call to /api/v1 — agents use the same layer.',
      [statusF.id]: 'todo',
      [tagsF.id]: ['data'],
      [priorityF.id]: 3,
      [budgetF.id]: 3500,
      [doneF.id]: false,
    },
  ]

  for (const values of rows) {
    await createRecord(orgId, table.id, values, SEED_ACTOR)
  }

  console.log(`Seeded "Getting Started" table (${table.id}) with ${rows.length} records.`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
