// Bases — workspace grouping of tables (migration 0011). Covers the base lifecycle
// (create/list/update/delete + slug uniquing), table membership (create-in-base, move
// between bases, ungroup), the delete-nonempty rejection, and tenant scoping.
import { beforeAll, describe, expect, it } from 'vitest'
import {
  createBase,
  createTable,
  deleteBase,
  describeTable,
  getBase,
  getBaseBySlug,
  listBases,
  listTables,
  updateBase,
  updateTable,
} from '../src/index'
import { actor, ensureTestOrg } from './helpers'

let orgId: string
const A = actor('user', 'u-1')

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required for engine tests')
  orgId = await ensureTestOrg()
})

describe('base lifecycle', () => {
  it('creates, lists, gets by slug, and slugs uniquely', async () => {
    const b1 = await createBase(orgId, { name: 'Sales CRM', icon: '🎯' }, A)
    expect(b1.slug).toBe('sales-crm')
    expect(b1.icon).toBe('🎯')
    expect(b1.created_by_type).toBe('user')

    const b2 = await createBase(orgId, { name: 'Sales CRM' }, A)
    expect(b2.slug).toBe('sales-crm-2')

    const all = await listBases(orgId)
    expect(all.map((b) => b.id)).toEqual(expect.arrayContaining([b1.id, b2.id]))

    expect((await getBaseBySlug(orgId, 'sales-crm'))?.id).toBe(b1.id)
    expect((await getBase(orgId, b1.id))?.name).toBe('Sales CRM')
  })

  it('rejects an empty name', async () => {
    await expect(createBase(orgId, { name: '   ' }, A)).rejects.toThrow(/name is required/i)
  })

  it('updates name/icon/position', async () => {
    const b = await createBase(orgId, { name: 'Temp' }, A)
    const updated = await updateBase(orgId, b.id, { name: 'Renamed', icon: '🤝', position: 5 })
    expect(updated.name).toBe('Renamed')
    expect(updated.icon).toBe('🤝')
    expect(updated.position).toBe(5)
    // Slug is untouched by renames.
    expect(updated.slug).toBe('temp')
  })

  it('deletes an empty base; a missing base is not_found', async () => {
    const b = await createBase(orgId, { name: 'Ephemeral' }, A)
    await deleteBase(orgId, b.id)
    expect(await getBase(orgId, b.id)).toBeNull()
    await expect(deleteBase(orgId, b.id)).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('table membership', () => {
  it('createTable accepts baseId; listTables/describeTable expose base_id', async () => {
    const base = await createBase(orgId, { name: `B ${Math.random()}` }, A)
    const table = await createTable(orgId, { name: `T ${Math.random()}`, baseId: base.id }, A)
    expect(table.base_id).toBe(base.id)

    const listed = await listTables(orgId)
    expect(listed.find((t) => t.id === table.id)?.base_id).toBe(base.id)

    const descriptor = await describeTable(orgId, table.id)
    expect(descriptor.table.base_id).toBe(base.id)
  })

  it('tables default to ungrouped (base_id null)', async () => {
    const table = await createTable(orgId, { name: `T ${Math.random()}` }, A)
    expect(table.base_id).toBeNull()
  })

  it('rejects a baseId that is not a base in this org', async () => {
    await expect(
      createTable(
        orgId,
        { name: 'nope', baseId: '00000000-0000-0000-0000-000000000000' },
        A,
      ),
    ).rejects.toMatchObject({ code: 'bad_input' })
    // Cross-org: a base belonging to another org is invisible here.
    const otherOrg = await ensureTestOrg()
    const foreign = await createBase(otherOrg, { name: 'Foreign' }, A)
    await expect(createTable(orgId, { name: 'nope2', baseId: foreign.id }, A)).rejects.toMatchObject(
      { code: 'bad_input' },
    )
  })

  it('updateTable moves a table between bases and can ungroup it (null)', async () => {
    const from = await createBase(orgId, { name: `From ${Math.random()}` }, A)
    const to = await createBase(orgId, { name: `To ${Math.random()}` }, A)
    const table = await createTable(orgId, { name: `T ${Math.random()}`, baseId: from.id }, A)

    const moved = await updateTable(orgId, table.id, { baseId: to.id })
    expect(moved.base_id).toBe(to.id)

    // A backfill-style adopt: set base on a previously ungrouped table.
    const ungrouped = await updateTable(orgId, table.id, { baseId: null })
    expect(ungrouped.base_id).toBeNull()
    const adopted = await updateTable(orgId, table.id, { baseId: from.id })
    expect(adopted.base_id).toBe(from.id)

    // Moving to a bogus base is rejected and leaves membership untouched.
    await expect(
      updateTable(orgId, table.id, { baseId: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toMatchObject({ code: 'bad_input' })
    expect((await describeTable(orgId, table.id)).table.base_id).toBe(from.id)
  })

  it('a patch without baseId leaves membership untouched', async () => {
    const base = await createBase(orgId, { name: `Keep ${Math.random()}` }, A)
    const table = await createTable(orgId, { name: `T ${Math.random()}`, baseId: base.id }, A)
    const renamed = await updateTable(orgId, table.id, { name: 'Renamed only' })
    expect(renamed.base_id).toBe(base.id)
  })
})

describe('delete-nonempty rejection', () => {
  it('refuses to delete a base that still contains tables; succeeds once emptied', async () => {
    const base = await createBase(orgId, { name: `Full ${Math.random()}` }, A)
    const table = await createTable(orgId, { name: `T ${Math.random()}`, baseId: base.id }, A)

    await expect(deleteBase(orgId, base.id)).rejects.toMatchObject({ code: 'bad_input' })
    // Base and table both survive the rejected delete.
    expect(await getBase(orgId, base.id)).not.toBeNull()
    expect((await describeTable(orgId, table.id)).table.base_id).toBe(base.id)

    await updateTable(orgId, table.id, { baseId: null })
    await deleteBase(orgId, base.id)
    expect(await getBase(orgId, base.id)).toBeNull()
    // The table lives on, ungrouped.
    expect((await describeTable(orgId, table.id)).table.base_id).toBeNull()
  })
})
