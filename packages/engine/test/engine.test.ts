// Engine service-layer tests against a real Postgres (working-agreement requirement).
// Covers: table/field/view/record CRUD, per-field-type coercion + validation failures,
// revision written on every record mutation, and queryRecords filter/sort/pagination.
import { beforeAll, describe, expect, it } from 'vitest'
import {
  EngineError,
  createField,
  createRecord,
  createTable,
  createView,
  deleteRecords,
  deleteView,
  describeTable,
  getRecord,
  listRecordRevisions,
  listTables,
  queryRecords,
  updateField,
  updateRecord,
  updateTable,
  updateView,
} from '../src/index'
import type { EngineField } from '../src/index'
import { actor, ensureTestOrg } from './helpers'

let orgId: string
const A = actor('user', 'u-1')

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required for engine tests')
  orgId = await ensureTestOrg()
})

// A helper that builds a table with one field of a given type + options.
async function tableWithField(
  type: EngineField['type'],
  options?: Record<string, unknown>,
  required = false,
) {
  const table = await createTable(orgId, { name: `T ${type} ${Math.random()}` }, A)
  const field = await createField(orgId, table.id, { name: 'f', type, options, required }, A)
  return { table, field }
}

describe('tables', () => {
  it('creates, lists, updates, and slugs uniquely', async () => {
    const t1 = await createTable(orgId, { name: 'Getting Started', icon: '🚀' }, A)
    expect(t1.slug).toBe('getting-started')
    expect(t1.created_by_type).toBe('user')
    const t2 = await createTable(orgId, { name: 'Getting Started' }, A)
    expect(t2.slug).toBe('getting-started-2')

    const updated = await updateTable(orgId, t1.id, { name: 'Renamed', description: 'hi' })
    expect(updated.name).toBe('Renamed')
    expect(updated.description).toBe('hi')

    const all = await listTables(orgId)
    expect(all.map((t) => t.id)).toContain(t1.id)
  })

  it('describeTable returns fields and views', async () => {
    const t = await createTable(orgId, { name: 'Described' }, A)
    await createField(orgId, t.id, { name: 'Title', type: 'text' }, A)
    await createView(orgId, t.id, { name: 'Grid', type: 'grid' })
    const d = await describeTable(orgId, t.id)
    expect(d.fields).toHaveLength(1)
    expect(d.views).toHaveLength(1)
  })
})

describe('field-type coercion — happy path', () => {
  it('text / long_text', async () => {
    const { table, field } = await tableWithField('text')
    const rec = await createRecord(orgId, table.id, { [field.id]: 'hello' }, A)
    expect(rec.values[field.id]).toBe('hello')
  })

  it('number coerces numeric strings', async () => {
    const { table, field } = await tableWithField('number')
    const rec = await createRecord(orgId, table.id, { [field.id]: '42.5' }, A)
    expect(rec.values[field.id]).toBe(42.5)
  })

  it('currency coerces to number', async () => {
    const { table, field } = await tableWithField('currency')
    const rec = await createRecord(orgId, table.id, { [field.id]: 1999.99 }, A)
    expect(rec.values[field.id]).toBe(1999.99)
  })

  it('checkbox coerces string booleans', async () => {
    const { table, field } = await tableWithField('checkbox')
    const rec = await createRecord(orgId, table.id, { [field.id]: 'true' }, A)
    expect(rec.values[field.id]).toBe(true)
  })

  it('date accepts ISO date', async () => {
    const { table, field } = await tableWithField('date')
    const rec = await createRecord(orgId, table.id, { [field.id]: '2026-07-04' }, A)
    expect(rec.values[field.id]).toBe('2026-07-04')
  })

  it('datetime normalizes to ISO', async () => {
    const { table, field } = await tableWithField('datetime')
    const rec = await createRecord(orgId, table.id, { [field.id]: '2026-07-04T12:00:00Z' }, A)
    expect(rec.values[field.id]).toBe('2026-07-04T12:00:00.000Z')
  })

  it('url and email accept valid values', async () => {
    const u = await tableWithField('url')
    const ur = await createRecord(orgId, u.table.id, { [u.field.id]: 'https://x.com' }, A)
    expect(ur.values[u.field.id]).toBe('https://x.com')

    const e = await tableWithField('email')
    const er = await createRecord(orgId, e.table.id, { [e.field.id]: 'a@b.com' }, A)
    expect(er.values[e.field.id]).toBe('a@b.com')
  })

  it('single_select validates choice id', async () => {
    const { table, field } = await tableWithField('single_select', {
      choices: [{ id: 'c1', name: 'One', color: 'blue' }],
    })
    const rec = await createRecord(orgId, table.id, { [field.id]: 'c1' }, A)
    expect(rec.values[field.id]).toBe('c1')
  })

  it('multi_select dedupes and validates choice ids', async () => {
    const { table, field } = await tableWithField('multi_select', {
      choices: [
        { id: 'a', name: 'A', color: 'red' },
        { id: 'b', name: 'B', color: 'green' },
      ],
    })
    const rec = await createRecord(orgId, table.id, { [field.id]: ['a', 'b', 'a'] }, A)
    expect(rec.values[field.id]).toEqual(['a', 'b'])
  })
})

describe('field-type coercion — validation failures', () => {
  it('rejects non-numeric in number', async () => {
    const { table, field } = await tableWithField('number')
    await expect(createRecord(orgId, table.id, { [field.id]: 'abc' }, A)).rejects.toThrow(EngineError)
  })

  it('rejects bad email', async () => {
    const { table, field } = await tableWithField('email')
    await expect(createRecord(orgId, table.id, { [field.id]: 'not-an-email' }, A)).rejects.toThrow(
      /valid email/,
    )
  })

  it('rejects bad url', async () => {
    const { table, field } = await tableWithField('url')
    await expect(createRecord(orgId, table.id, { [field.id]: 'not a url' }, A)).rejects.toThrow(/URL/)
  })

  it('rejects non-ISO date', async () => {
    const { table, field } = await tableWithField('date')
    await expect(createRecord(orgId, table.id, { [field.id]: '07/04/2026' }, A)).rejects.toThrow(
      /ISO date/,
    )
  })

  it('rejects unknown select choice', async () => {
    const { table, field } = await tableWithField('single_select', {
      choices: [{ id: 'c1', name: 'One', color: 'blue' }],
    })
    await expect(createRecord(orgId, table.id, { [field.id]: 'nope' }, A)).rejects.toThrow(
      /not a valid choice/,
    )
  })

  it('rejects non-boolean checkbox', async () => {
    const { table, field } = await tableWithField('checkbox')
    await expect(createRecord(orgId, table.id, { [field.id]: 'maybe' }, A)).rejects.toThrow(
      /boolean/,
    )
  })

  it('enforces required on create and on clearing', async () => {
    const { table, field } = await tableWithField('text', undefined, true)
    await expect(createRecord(orgId, table.id, {}, A)).rejects.toThrow(/required/)
    const rec = await createRecord(orgId, table.id, { [field.id]: 'x' }, A)
    await expect(updateRecord(orgId, table.id, rec.id, { [field.id]: '' }, A)).rejects.toThrow(
      /required/,
    )
  })

  it('rejects unknown field id', async () => {
    const { table } = await tableWithField('text')
    await expect(
      createRecord(orgId, table.id, { 'no-such-field': 'x' }, A),
    ).rejects.toThrow(/Unknown field/)
  })

  it('rejects duplicate select choice ids at field create', async () => {
    const table = await createTable(orgId, { name: 'DupChoices' }, A)
    await expect(
      createField(
        orgId,
        table.id,
        {
          name: 'sel',
          type: 'single_select',
          options: { choices: [{ id: 'x', name: 'X', color: 'red' }, { id: 'x', name: 'Y', color: 'blue' }] },
        },
        A,
      ),
    ).rejects.toThrow(/Duplicate/)
  })
})

describe('revisions', () => {
  it('writes create/update/delete revisions with attribution and diffs', async () => {
    const { table, field } = await tableWithField('text')
    const rec = await createRecord(orgId, table.id, { [field.id]: 'v1' }, actor('agent', 'bot'))

    let revs = await listRecordRevisions(orgId, rec.id)
    expect(revs).toHaveLength(1)
    expect(revs[0]!.op).toBe('create')
    expect(revs[0]!.actor_type).toBe('agent')
    expect(revs[0]!.actor_id).toBe('bot')
    expect(revs[0]!.diff[field.id]).toEqual({ from: null, to: 'v1' })

    await updateRecord(orgId, table.id, rec.id, { [field.id]: 'v2' }, actor('user', 'u9'))
    revs = await listRecordRevisions(orgId, rec.id)
    expect(revs).toHaveLength(2)
    const upd = revs.find((r) => r.op === 'update')!
    expect(upd.diff[field.id]).toEqual({ from: 'v1', to: 'v2' })

    // No-op update writes no revision.
    await updateRecord(orgId, table.id, rec.id, { [field.id]: 'v2' }, A)
    revs = await listRecordRevisions(orgId, rec.id)
    expect(revs).toHaveLength(2)

    await deleteRecords(orgId, table.id, [rec.id], actor('api'))
    revs = await listRecordRevisions(orgId, rec.id)
    expect(revs).toHaveLength(3)
    const del = revs.find((r) => r.op === 'delete')!
    expect(del.actor_type).toBe('api')
    expect(del.diff[field.id]).toEqual({ from: 'v2', to: null })
    // Record itself is gone; revisions survive.
    expect(await getRecord(orgId, table.id, rec.id)).toBeNull()
  })
})

describe('queryRecords — filter / sort / pagination', () => {
  it('filters, sorts, and paginates', async () => {
    const table = await createTable(orgId, { name: 'Query' }, A)
    const nameF = await createField(orgId, table.id, { name: 'Name', type: 'text' }, A)
    const scoreF = await createField(orgId, table.id, { name: 'Score', type: 'number' }, A)

    for (const [n, s] of [
      ['Alpha', 30],
      ['Bravo', 10],
      ['Charlie', 20],
      ['Delta', 40],
    ] as const) {
      await createRecord(orgId, table.id, { [nameF.id]: n, [scoreF.id]: s }, A)
    }

    // sort by score asc
    const asc = await queryRecords(orgId, table.id, { sorts: [{ fieldId: scoreF.id, direction: 'asc' }] })
    expect(asc.total).toBe(4)
    expect(asc.records.map((r) => r.values[scoreF.id])).toEqual([10, 20, 30, 40])

    // filter score >= 20
    const filtered = await queryRecords(orgId, table.id, {
      filters: [{ fieldId: scoreF.id, op: 'gte', value: 20 }],
      sorts: [{ fieldId: scoreF.id, direction: 'asc' }],
    })
    expect(filtered.total).toBe(3)
    expect(filtered.records.map((r) => r.values[scoreF.id])).toEqual([20, 30, 40])

    // contains on text
    const contains = await queryRecords(orgId, table.id, {
      filters: [{ fieldId: nameF.id, op: 'contains', value: 'ra' }],
    })
    expect(contains.total).toBe(1)
    expect(contains.records[0]!.values[nameF.id]).toBe('Bravo')

    // pagination: limit 2 offset 1 on score desc
    const page = await queryRecords(orgId, table.id, {
      sorts: [{ fieldId: scoreF.id, direction: 'desc' }],
      limit: 2,
      offset: 1,
    })
    expect(page.total).toBe(4)
    expect(page.limit).toBe(2)
    expect(page.offset).toBe(1)
    expect(page.records.map((r) => r.values[scoreF.id])).toEqual([30, 20])
  })
})

describe('fields & views mutation', () => {
  it('updateField renames without touching record values (values key on id)', async () => {
    const { table, field } = await tableWithField('text')
    const rec = await createRecord(orgId, table.id, { [field.id]: 'keep' }, A)
    await updateField(orgId, table.id, field.id, { name: 'Renamed Field' })
    const after = await getRecord(orgId, table.id, rec.id)
    expect(after!.values[field.id]).toBe('keep')
  })

  it('view CRUD works and supports kanban type', async () => {
    const table = await createTable(orgId, { name: 'Views' }, A)
    const v = await createView(orgId, table.id, { name: 'Board', type: 'kanban', config: { groupByFieldId: null } })
    expect(v.type).toBe('kanban')
    const u = await updateView(orgId, table.id, v.id, { name: 'Board 2' })
    expect(u.name).toBe('Board 2')
    await deleteView(orgId, table.id, v.id)
  })
})
