// Phase B review-fixes + Phase B.5 (percent / formula) engine tests.
// Part A: updateField repoint rejection & inverse preservation, deleteTable far-side field
// cleanup, computed-field robustness after target-field deletion, numeric-aggregate rounding.
// Part B: percent coercion, formula parse/validate/evaluate + computed-field semantics.
import { beforeAll, describe, expect, it } from 'vitest'
import {
  EngineError,
  createField,
  createRecord,
  createTable,
  deleteField,
  deleteTable,
  getRecordEnriched,
  listFields,
  queryRecords,
  updateField,
  updateRecord,
} from '../src/index'
import { actor, ensureTestOrg } from './helpers'

let orgId: string
const A = actor('user', 'u-1')

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required for engine tests')
  orgId = await ensureTestOrg()
})

// ---------------------------------------------------------------------------
// A1 — updateField on a linked_record field
// ---------------------------------------------------------------------------
describe('A1: linked_record updateField guards', () => {
  async function makeLink() {
    const t1 = await createTable(orgId, { name: `A1a ${Math.random()}` }, A)
    const t2 = await createTable(orgId, { name: `A1b ${Math.random()}` }, A)
    const link = await createField(
      orgId, t2.id,
      { name: 'Rel', type: 'linked_record', options: { linkedTableId: t1.id } }, A,
    )
    return { t1, t2, link }
  }

  it('rejects repointing linkedTableId', async () => {
    const { t2, link } = await makeLink()
    const other = await createTable(orgId, { name: `A1c ${Math.random()}` }, A)
    await expect(
      updateField(orgId, t2.id, link.id, { options: { linkedTableId: other.id } }),
    ).rejects.toThrow(/Cannot repoint/)
  })

  it('preserves inverseFieldId on an options update that omits it', async () => {
    const { t2, link } = await makeLink()
    const inverseId = link.options.inverseFieldId
    expect(inverseId).toBeTruthy()
    // Update with options that DON'T carry inverseFieldId (and re-send the same linkedTableId).
    const updated = await updateField(orgId, t2.id, link.id, {
      options: { linkedTableId: link.options.linkedTableId },
    })
    expect(updated.options.inverseFieldId).toBe(inverseId)
    // Even if a caller tries to spoof a bogus inverseFieldId, the engine keeps the real one.
    const spoofed = await updateField(orgId, t2.id, link.id, {
      options: { linkedTableId: link.options.linkedTableId, inverseFieldId: 'bogus' },
    })
    expect(spoofed.options.inverseFieldId).toBe(inverseId)
  })
})

// ---------------------------------------------------------------------------
// A2 — deleteTable removes far-side linked fields
// ---------------------------------------------------------------------------
describe('A2: deleteTable cleans up far-side link fields', () => {
  it('drops the other table’s link field and leaves its records readable', async () => {
    const a = await createTable(orgId, { name: `A2A ${Math.random()}` }, A)
    const aName = await createField(orgId, a.id, { name: 'Name', type: 'text' }, A)
    const b = await createTable(orgId, { name: `A2B ${Math.random()}` }, A)
    // Link lives on A pointing at B; inverse auto-created on B.
    const link = await createField(
      orgId, a.id,
      { name: 'ToB', type: 'linked_record', options: { linkedTableId: b.id } }, A,
    )
    const bRec = await createRecord(orgId, b.id, {}, A)
    const aRec = await createRecord(orgId, a.id, { [aName.id]: 'keep', [link.id]: [bRec.id] }, A)

    await deleteTable(orgId, b.id)

    // A's link field (which pointed at the now-deleted B) is gone.
    const aFields = await listFields(orgId, a.id)
    expect(aFields.find((f) => f.id === link.id)).toBeUndefined()
    // A's record still reads cleanly (no dangling link enrichment).
    const read = await getRecordEnriched(orgId, a.id, aRec.id)
    expect(read).not.toBeNull()
    expect(read!.values[aName.id]).toBe('keep')
  })
})

// ---------------------------------------------------------------------------
// A3 — computed fields recompute as empty after target-field deletion
// ---------------------------------------------------------------------------
describe('A3: lookup/rollup after target field deleted', () => {
  async function fixture() {
    const clients = await createTable(orgId, { name: `A3C ${Math.random()}` }, A)
    await createField(orgId, clients.id, { name: 'Name', type: 'text' }, A)
    const orders = await createTable(orgId, { name: `A3O ${Math.random()}` }, A)
    const amount = await createField(orgId, orders.id, { name: 'Amount', type: 'number' }, A)
    const link = await createField(
      orgId, clients.id,
      { name: 'Orders', type: 'linked_record', options: { linkedTableId: orders.id } }, A,
    )
    return { clients, orders, amount, link }
  }

  it('rollup returns null/0 (per aggregate) after target field deletion, not stale values', async () => {
    const f = await fixture()
    const o1 = await createRecord(orgId, f.orders.id, { [f.amount.id]: 100 }, A)
    const o2 = await createRecord(orgId, f.orders.id, { [f.amount.id]: 250 }, A)
    const sum = await createField(
      orgId, f.clients.id,
      { name: 'sum', type: 'rollup', options: { recordLinkFieldId: f.link.id, targetFieldId: f.amount.id, aggregate: 'sum' } }, A,
    )
    const avg = await createField(
      orgId, f.clients.id,
      { name: 'avg', type: 'rollup', options: { recordLinkFieldId: f.link.id, targetFieldId: f.amount.id, aggregate: 'avg' } }, A,
    )
    const lookup = await createField(
      orgId, f.clients.id,
      { name: 'amts', type: 'lookup', options: { recordLinkFieldId: f.link.id, targetFieldId: f.amount.id } }, A,
    )
    const client = await createRecord(orgId, f.clients.id, { [f.link.id]: [o1.id, o2.id] }, A)

    // Before deletion: real values.
    let read = await getRecordEnriched(orgId, f.clients.id, client.id)
    expect(read!.display[sum.id]).toBe(350)

    // Delete the target field; computed fields must recompute as empty, not stale.
    await deleteField(orgId, f.orders.id, f.amount.id)
    read = await getRecordEnriched(orgId, f.clients.id, client.id)
    expect(read!.display[sum.id]).toBe(0) // sum of empty set
    expect(read!.display[avg.id]).toBeNull() // avg of empty set
    expect(read!.display[lookup.id]).toEqual([]) // lookup of empty set
  })
})

// ---------------------------------------------------------------------------
// A4 — numeric aggregate rounding to target field precision
// ---------------------------------------------------------------------------
describe('A4: rollup rounds to target field precision', () => {
  it('sum of 0.1 + 0.2 over currency equals 0.3 exactly', async () => {
    const clients = await createTable(orgId, { name: `A4C ${Math.random()}` }, A)
    await createField(orgId, clients.id, { name: 'Name', type: 'text' }, A)
    const orders = await createTable(orgId, { name: `A4O ${Math.random()}` }, A)
    const price = await createField(orgId, orders.id, { name: 'Price', type: 'currency' }, A)
    const link = await createField(
      orgId, clients.id,
      { name: 'Orders', type: 'linked_record', options: { linkedTableId: orders.id } }, A,
    )
    const o1 = await createRecord(orgId, orders.id, { [price.id]: 0.1 }, A)
    const o2 = await createRecord(orgId, orders.id, { [price.id]: 0.2 }, A)
    const sum = await createField(
      orgId, clients.id,
      { name: 'total', type: 'rollup', options: { recordLinkFieldId: link.id, targetFieldId: price.id, aggregate: 'sum' } }, A,
    )
    const client = await createRecord(orgId, clients.id, { [link.id]: [o1.id, o2.id] }, A)
    const read = await getRecordEnriched(orgId, clients.id, client.id)
    expect(read!.display[sum.id]).toBe(0.3) // rounded to currency precision 2, not 0.30000000000000004
  })
})

// ---------------------------------------------------------------------------
// B1 — percent field type
// ---------------------------------------------------------------------------
describe('B1: percent field', () => {
  async function percentTable() {
    const t = await createTable(orgId, { name: `Pct ${Math.random()}` }, A)
    const p = await createField(orgId, t.id, { name: 'Confidence', type: 'percent' }, A)
    return { t, p }
  }

  it('coerces a number to a stored fraction as-is (no clamping)', async () => {
    const { t, p } = await percentTable()
    const r = await createRecord(orgId, t.id, { [p.id]: 0.5 }, A)
    expect(r.values[p.id]).toBe(0.5)
    // >1 and negative are allowed.
    const r2 = await createRecord(orgId, t.id, { [p.id]: 1.5 }, A)
    expect(r2.values[p.id]).toBe(1.5)
    const r3 = await createRecord(orgId, t.id, { [p.id]: -0.25 }, A)
    expect(r3.values[p.id]).toBe(-0.25)
  })

  it('coerces a numeric string and a %-suffixed string', async () => {
    const { t, p } = await percentTable()
    const r1 = await createRecord(orgId, t.id, { [p.id]: '0.75' }, A)
    expect(r1.values[p.id]).toBe(0.75)
    const r2 = await createRecord(orgId, t.id, { [p.id]: '50%' }, A)
    expect(r2.values[p.id]).toBe(0.5)
  })

  it('rejects a non-numeric percent value', async () => {
    const { t, p } = await percentTable()
    await expect(createRecord(orgId, t.id, { [p.id]: 'abc' }, A)).rejects.toThrow(EngineError)
  })

  it('is sortable and filterable like a number', async () => {
    const t = await createTable(orgId, { name: `PctSort ${Math.random()}` }, A)
    const p = await createField(orgId, t.id, { name: 'C', type: 'percent' }, A)
    await createRecord(orgId, t.id, { [p.id]: 0.3 }, A)
    await createRecord(orgId, t.id, { [p.id]: 0.1 }, A)
    await createRecord(orgId, t.id, { [p.id]: 0.9 }, A)
    const asc = await queryRecords(orgId, t.id, { sorts: [{ fieldId: p.id, direction: 'asc' }] })
    expect(asc.records.map((r) => r.values[p.id])).toEqual([0.1, 0.3, 0.9])
    const filtered = await queryRecords(orgId, t.id, {
      filters: [{ fieldId: p.id, op: 'gte', value: 0.3 }],
    })
    expect(filtered.total).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// B2 — formula field type
// ---------------------------------------------------------------------------
describe('B2: formula field', () => {
  async function formulaTable() {
    const t = await createTable(orgId, { name: `Fx ${Math.random()}` }, A)
    const value = await createField(orgId, t.id, { name: 'Value', type: 'currency' }, A)
    const conf = await createField(orgId, t.id, { name: 'Conf', type: 'percent' }, A)
    return { t, value, conf }
  }

  it('computes arithmetic over same-record number/currency/percent fields at read time', async () => {
    const { t, value, conf } = await formulaTable()
    const weighted = await createField(
      orgId, t.id,
      { name: 'Weighted', type: 'formula', options: { expression: `{fld:${value.id}} * {fld:${conf.id}}` } }, A,
    )
    const rec = await createRecord(orgId, t.id, { [value.id]: 1000, [conf.id]: 0.5 }, A)
    const read = await getRecordEnriched(orgId, t.id, rec.id)
    expect(read!.display[weighted.id]).toBe(500)
  })

  it('honors + - * / and parentheses precedence', async () => {
    const t = await createTable(orgId, { name: `FxP ${Math.random()}` }, A)
    const a = await createField(orgId, t.id, { name: 'A', type: 'number' }, A)
    const b = await createField(orgId, t.id, { name: 'B', type: 'number' }, A)
    const f = await createField(
      orgId, t.id,
      { name: 'F', type: 'formula', options: { expression: `({fld:${a.id}} + {fld:${b.id}}) * 2 - 1` } }, A,
    )
    const rec = await createRecord(orgId, t.id, { [a.id]: 3, [b.id]: 4 }, A)
    const read = await getRecordEnriched(orgId, t.id, rec.id)
    expect(read!.display[f.id]).toBe(13) // (3+4)*2-1
  })

  it('null on division by zero or a null operand', async () => {
    const t = await createTable(orgId, { name: `FxN ${Math.random()}` }, A)
    const a = await createField(orgId, t.id, { name: 'A', type: 'number' }, A)
    const b = await createField(orgId, t.id, { name: 'B', type: 'number' }, A)
    const div = await createField(
      orgId, t.id,
      { name: 'Div', type: 'formula', options: { expression: `{fld:${a.id}} / {fld:${b.id}}` } }, A,
    )
    // b = 0 -> null
    const r1 = await createRecord(orgId, t.id, { [a.id]: 10, [b.id]: 0 }, A)
    expect((await getRecordEnriched(orgId, t.id, r1.id))!.display[div.id]).toBeNull()
    // b absent -> null operand -> null
    const r2 = await createRecord(orgId, t.id, { [a.id]: 10 }, A)
    expect((await getRecordEnriched(orgId, t.id, r2.id))!.display[div.id]).toBeNull()
  })

  it('rejects an unparseable expression', async () => {
    const { t, value } = await formulaTable()
    await expect(
      createField(orgId, t.id, { name: 'Bad', type: 'formula', options: { expression: `{fld:${value.id}} + ` } }, A),
    ).rejects.toThrow(EngineError)
  })

  it('rejects referencing a non-existent or non-numeric field (no chaining)', async () => {
    const t = await createTable(orgId, { name: `FxRej ${Math.random()}` }, A)
    const name = await createField(orgId, t.id, { name: 'Name', type: 'text' }, A)
    // Non-numeric reference.
    await expect(
      createField(orgId, t.id, { name: 'F1', type: 'formula', options: { expression: `{fld:${name.id}} * 2` } }, A),
    ).rejects.toThrow(/number\/currency\/percent/)
    // Reference to a field not on this table.
    await expect(
      createField(orgId, t.id, { name: 'F2', type: 'formula', options: { expression: `{fld:00000000-0000-0000-0000-000000000000} + 1` } }, A),
    ).rejects.toThrow(/isn't on this table/)
  })

  it('rejects referencing another formula (no chaining in v1)', async () => {
    const t = await createTable(orgId, { name: `FxChain ${Math.random()}` }, A)
    const n = await createField(orgId, t.id, { name: 'N', type: 'number' }, A)
    const f1 = await createField(
      orgId, t.id,
      { name: 'F1', type: 'formula', options: { expression: `{fld:${n.id}} + 1` } }, A,
    )
    await expect(
      createField(orgId, t.id, { name: 'F2', type: 'formula', options: { expression: `{fld:${f1.id}} + 1` } }, A),
    ).rejects.toThrow(/number\/currency\/percent/)
  })

  it('is read-only (rejects writes) and non-sortable/non-filterable', async () => {
    const { t, value } = await formulaTable()
    const f = await createField(
      orgId, t.id,
      { name: 'F', type: 'formula', options: { expression: `{fld:${value.id}} * 2` } }, A,
    )
    await expect(createRecord(orgId, t.id, { [f.id]: 5 }, A)).rejects.toThrow(/computed/)
    await expect(
      queryRecords(orgId, t.id, { sorts: [{ fieldId: f.id, direction: 'asc' }] }),
    ).rejects.toThrow(EngineError)
    await expect(
      queryRecords(orgId, t.id, { filters: [{ fieldId: f.id, op: 'gt', value: 0 }] }),
    ).rejects.toThrow(EngineError)
  })
})
