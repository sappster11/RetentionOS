// Phase D engine tests — filtered lookups/rollups (options.filters over the linked table's
// concrete fields, AND-ed, view-filter-grammar subset eq/neq/is_empty/is_not_empty) plus
// rollup MIN/MAX over date fields (ISO strings compare lexicographically ≡ chronologically;
// the numeric rounding path must not touch them). Doc: docs/10-client-hub.md §"Engine work
// this spec pulls forward".
import { beforeAll, describe, expect, it } from 'vitest'
import {
  EngineError,
  createField,
  createRecord,
  createTable,
  deleteField,
  getRecordEnriched,
  updateField,
  updateRecord,
} from '../src/index'
import type { EngineField } from '../src/index'
import { actor, ensureTestOrg } from './helpers'

let orgId: string
const A = actor('user', 'u-1')

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required for engine tests')
  orgId = await ensureTestOrg()
})

/**
 * The doc-10 shape: Clients link to Assignments (Person text, Role select, End date,
 * Hours number). "Active PM" = rollup/lookup over Assignments where End is_empty ∧ Role=PM.
 */
async function fixture() {
  const clients = await createTable(orgId, { name: `D-Clients ${Math.random()}` }, A)
  await createField(orgId, clients.id, { name: 'Name', type: 'text' }, A)
  const asg = await createTable(orgId, { name: `D-Assignments ${Math.random()}` }, A)
  const person = await createField(orgId, asg.id, { name: 'Person', type: 'text' }, A)
  const role = await createField(
    orgId,
    asg.id,
    {
      name: 'Role',
      type: 'single_select',
      options: {
        choices: [
          { id: 'pm', name: 'PM', color: 'blue' },
          { id: 'st', name: 'Strategist', color: 'green' },
        ],
      },
    },
    A,
  )
  const end = await createField(orgId, asg.id, { name: 'End', type: 'date' }, A)
  const hours = await createField(orgId, asg.id, { name: 'Hours', type: 'number' }, A)
  const link = await createField(
    orgId,
    clients.id,
    { name: 'Assignments', type: 'linked_record', options: { linkedTableId: asg.id } },
    A,
  )
  return { clients, asg, person, role, end, hours, link }
}

type Fx = Awaited<ReturnType<typeof fixture>>

/** Three assignments: active PM (Ana), ended PM (Bob), active Strategist (Cyd). */
async function seedAssignments(f: Fx) {
  const ana = await createRecord(
    orgId, f.asg.id,
    { [f.person.id]: 'Ana', [f.role.id]: 'pm', [f.hours.id]: 10 }, A,
  )
  const bob = await createRecord(
    orgId, f.asg.id,
    { [f.person.id]: 'Bob', [f.role.id]: 'pm', [f.end.id]: '2025-01-31', [f.hours.id]: 5 }, A,
  )
  const cyd = await createRecord(
    orgId, f.asg.id,
    { [f.person.id]: 'Cyd', [f.role.id]: 'st', [f.hours.id]: 10 }, A,
  )
  return { ana, bob, cyd }
}

function rollup(f: Fx, name: string, options: EngineField['options']) {
  return createField(orgId, f.clients.id, { name, type: 'rollup', options }, A)
}
function lookup(f: Fx, name: string, options: EngineField['options']) {
  return createField(orgId, f.clients.id, { name, type: 'lookup', options }, A)
}

describe('filtered rollups', () => {
  it('count with is_empty ∧ eq filters counts only matching rows (the Active-PM case)', async () => {
    const f = await fixture()
    const { ana, bob, cyd } = await seedAssignments(f)
    const activePMs = await rollup(f, 'Active PMs', {
      recordLinkFieldId: f.link.id,
      aggregate: 'count',
      filters: [
        { fieldId: f.end.id, op: 'is_empty' },
        { fieldId: f.role.id, op: 'eq', value: 'pm' },
      ],
    })
    const client = await createRecord(
      orgId, f.clients.id, { [f.link.id]: [ana.id, bob.id, cyd.id] }, A,
    )
    const read = await getRecordEnriched(orgId, f.clients.id, client.id)
    expect(read!.display[activePMs.id]).toBe(1) // only Ana: PM ∧ End empty
  })

  it('sum with an eq filter aggregates only matching rows (numeric filter value as string)', async () => {
    const f = await fixture()
    const { ana, bob, cyd } = await seedAssignments(f)
    const pmHours = await rollup(f, 'PM hours', {
      recordLinkFieldId: f.link.id,
      targetFieldId: f.hours.id,
      aggregate: 'sum',
      filters: [{ fieldId: f.role.id, op: 'eq', value: 'pm' }],
    })
    // Numeric eq compares numerically, so a string filter value still matches.
    const tenHours = await rollup(f, 'Ten-hour count', {
      recordLinkFieldId: f.link.id,
      aggregate: 'count',
      filters: [{ fieldId: f.hours.id, op: 'eq', value: '10' }],
    })
    const client = await createRecord(
      orgId, f.clients.id, { [f.link.id]: [ana.id, bob.id, cyd.id] }, A,
    )
    const read = await getRecordEnriched(orgId, f.clients.id, client.id)
    expect(read!.display[pmHours.id]).toBe(15) // Ana 10 + Bob 5
    expect(read!.display[tenHours.id]).toBe(2) // Ana + Cyd
  })

  it('neq keeps is-distinct-from semantics: empty values match', async () => {
    const f = await fixture()
    const { ana, cyd } = await seedAssignments(f)
    const noRole = await createRecord(orgId, f.asg.id, { [f.person.id]: 'Dee' }, A) // Role empty
    const notPM = await rollup(f, 'Non-PM count', {
      recordLinkFieldId: f.link.id,
      aggregate: 'count',
      filters: [{ fieldId: f.role.id, op: 'neq', value: 'pm' }],
    })
    const client = await createRecord(
      orgId, f.clients.id, { [f.link.id]: [ana.id, cyd.id, noRole.id] }, A,
    )
    const read = await getRecordEnriched(orgId, f.clients.id, client.id)
    expect(read!.display[notPM.id]).toBe(2) // Cyd (st) + Dee (empty role) — not Ana (pm)
  })

  it('empty filtered set keeps per-aggregate empty semantics (sum 0, avg/min/max null)', async () => {
    const f = await fixture()
    const { bob } = await seedAssignments(f) // only Bob linked; filter excludes him
    const mk = (name: string, aggregate: string) =>
      rollup(f, name, {
        recordLinkFieldId: f.link.id,
        targetFieldId: f.hours.id,
        aggregate: aggregate as never,
        filters: [{ fieldId: f.end.id, op: 'is_empty' }], // Bob has an End date
      })
    const sum = await mk('s', 'sum')
    const avg = await mk('a', 'avg')
    const min = await mk('mn', 'min')
    const max = await mk('mx', 'max')
    const client = await createRecord(orgId, f.clients.id, { [f.link.id]: [bob.id] }, A)
    const read = await getRecordEnriched(orgId, f.clients.id, client.id)
    expect(read!.display[sum.id]).toBe(0)
    expect(read!.display[avg.id]).toBeNull()
    expect(read!.display[min.id]).toBeNull()
    expect(read!.display[max.id]).toBeNull()
  })
})

describe('filtered lookups', () => {
  it('returns only matching values, in link order, and reacts to linked-row edits', async () => {
    const f = await fixture()
    const { ana, bob, cyd } = await seedAssignments(f)
    const activePeople = await lookup(f, 'Active people', {
      recordLinkFieldId: f.link.id,
      targetFieldId: f.person.id,
      filters: [{ fieldId: f.end.id, op: 'is_empty' }],
    })
    const client = await createRecord(
      orgId, f.clients.id, { [f.link.id]: [ana.id, bob.id, cyd.id] }, A,
    )
    let read = await getRecordEnriched(orgId, f.clients.id, client.id)
    expect(read!.display[activePeople.id]).toEqual(['Ana', 'Cyd']) // Bob's assignment ended

    // End Ana's assignment → she drops out at the next read (computed at read time).
    await updateRecord(orgId, f.asg.id, ana.id, { [f.end.id]: '2025-06-30' }, A)
    read = await getRecordEnriched(orgId, f.clients.id, client.id)
    expect(read!.display[activePeople.id]).toEqual(['Cyd'])
  })

  it('unfiltered lookup/rollup behavior is unchanged (regression)', async () => {
    const f = await fixture()
    const { ana, bob, cyd } = await seedAssignments(f)
    const people = await lookup(f, 'People', {
      recordLinkFieldId: f.link.id,
      targetFieldId: f.person.id,
    })
    const n = await rollup(f, 'n', { recordLinkFieldId: f.link.id, aggregate: 'count' })
    const client = await createRecord(
      orgId, f.clients.id, { [f.link.id]: [ana.id, bob.id, cyd.id] }, A,
    )
    const read = await getRecordEnriched(orgId, f.clients.id, client.id)
    expect(read!.display[people.id]).toEqual(['Ana', 'Bob', 'Cyd'])
    expect(read!.display[n.id]).toBe(3)
  })
})

describe('filters validation (createField / updateField)', () => {
  it('rejects a filter fieldId that is not on the linked table', async () => {
    const f = await fixture()
    await expect(
      rollup(f, 'bad', {
        recordLinkFieldId: f.link.id,
        aggregate: 'count',
        filters: [{ fieldId: '00000000-0000-0000-0000-000000000000', op: 'is_empty' }],
      }),
    ).rejects.toThrow(/not a field on the linked table/)
  })

  it('rejects computed and linked_record filter fields (concrete only)', async () => {
    const f = await fixture()
    const auto = await createField(orgId, f.asg.id, { name: 'Num', type: 'autonumber' }, A)
    await expect(
      lookup(f, 'bad', {
        recordLinkFieldId: f.link.id,
        targetFieldId: f.person.id,
        filters: [{ fieldId: auto.id, op: 'is_not_empty' }],
      }),
    ).rejects.toThrow(/concrete/)
    // The auto-created inverse link field on Assignments is linked_record — also rejected.
    const inverseId = f.link.options.inverseFieldId!
    await expect(
      rollup(f, 'bad2', {
        recordLinkFieldId: f.link.id,
        aggregate: 'count',
        filters: [{ fieldId: inverseId, op: 'is_empty' }],
      }),
    ).rejects.toThrow(/concrete/)
  })

  it('rejects ops outside the v1 grammar and bad shapes', async () => {
    const f = await fixture()
    await expect(
      rollup(f, 'bad', {
        recordLinkFieldId: f.link.id,
        aggregate: 'count',
        filters: [{ fieldId: f.role.id, op: 'contains' as never, value: 'p' }],
      }),
    ).rejects.toThrow(/op must be one of eq, neq, is_empty, is_not_empty/)
    await expect(
      rollup(f, 'bad2', {
        recordLinkFieldId: f.link.id,
        aggregate: 'count',
        filters: 'nope' as never,
      }),
    ).rejects.toThrow(/must be an array/)
    await expect(
      rollup(f, 'bad3', {
        recordLinkFieldId: f.link.id,
        aggregate: 'count',
        filters: [{ op: 'is_empty' } as never],
      }),
    ).rejects.toThrow(/string fieldId/)
  })

  it('requires a value for eq/neq and forbids one for is_empty/is_not_empty', async () => {
    const f = await fixture()
    await expect(
      rollup(f, 'bad', {
        recordLinkFieldId: f.link.id,
        aggregate: 'count',
        filters: [{ fieldId: f.role.id, op: 'eq' }],
      }),
    ).rejects.toThrow(/requires a value/)
    await expect(
      rollup(f, 'bad2', {
        recordLinkFieldId: f.link.id,
        aggregate: 'count',
        filters: [{ fieldId: f.end.id, op: 'is_empty', value: 'x' }],
      }),
    ).rejects.toThrow(/does not take a value/)
  })

  it('updateField validates filters too, and new filters take effect on compute', async () => {
    const f = await fixture()
    const { ana, bob, cyd } = await seedAssignments(f)
    const n = await rollup(f, 'n', { recordLinkFieldId: f.link.id, aggregate: 'count' })
    const client = await createRecord(
      orgId, f.clients.id, { [f.link.id]: [ana.id, bob.id, cyd.id] }, A,
    )
    // Bad filter on update → rejected.
    await expect(
      updateField(orgId, f.clients.id, n.id, {
        options: {
          recordLinkFieldId: f.link.id,
          aggregate: 'count',
          filters: [{ fieldId: '00000000-0000-0000-0000-000000000000', op: 'is_empty' }],
        },
      }),
    ).rejects.toThrow(/not a field on the linked table/)
    // Good filter on update → the rollup recomputes filtered.
    await updateField(orgId, f.clients.id, n.id, {
      options: {
        recordLinkFieldId: f.link.id,
        aggregate: 'count',
        filters: [{ fieldId: f.role.id, op: 'eq', value: 'pm' }],
      },
    })
    const read = await getRecordEnriched(orgId, f.clients.id, client.id)
    expect(read!.display[n.id]).toBe(2) // Ana + Bob are PMs
  })
})

describe('stale filter fields', () => {
  it('a deleted filters[].fieldId makes the lookup/rollup compute as empty, not crash/stale', async () => {
    const f = await fixture()
    const { ana, bob, cyd } = await seedAssignments(f)
    const opts = { filters: [{ fieldId: f.role.id, op: 'eq', value: 'pm' } as const] }
    const n = await rollup(f, 'n', { recordLinkFieldId: f.link.id, aggregate: 'count', ...opts })
    const sum = await rollup(f, 's', {
      recordLinkFieldId: f.link.id, targetFieldId: f.hours.id, aggregate: 'sum', ...opts,
    })
    const avg = await rollup(f, 'a', {
      recordLinkFieldId: f.link.id, targetFieldId: f.hours.id, aggregate: 'avg', ...opts,
    })
    const people = await lookup(f, 'p', {
      recordLinkFieldId: f.link.id, targetFieldId: f.person.id, ...opts,
    })
    const client = await createRecord(
      orgId, f.clients.id, { [f.link.id]: [ana.id, bob.id, cyd.id] }, A,
    )
    // Live before deletion.
    let read = await getRecordEnriched(orgId, f.clients.id, client.id)
    expect(read!.display[n.id]).toBe(2)
    expect(read!.display[sum.id]).toBe(15)
    expect(read!.display[people.id]).toEqual(['Ana', 'Bob'])

    // Delete the FILTER field on the linked table (target + link fields still fine).
    await deleteField(orgId, f.asg.id, f.role.id)
    read = await getRecordEnriched(orgId, f.clients.id, client.id)
    expect(read!.display[n.id]).toBe(0)
    expect(read!.display[sum.id]).toBe(0)
    expect(read!.display[avg.id]).toBeNull()
    expect(read!.display[people.id]).toEqual([])
  })
})

describe('rollup min/max over date fields', () => {
  it('returns the correct ISO date via lexicographic order, untouched by numeric rounding', async () => {
    const clients = await createTable(orgId, { name: `D-DateC ${Math.random()}` }, A)
    await createField(orgId, clients.id, { name: 'Name', type: 'text' }, A)
    const eng = await createTable(orgId, { name: `D-Eng ${Math.random()}` }, A)
    const start = await createField(orgId, eng.id, { name: 'Start', type: 'date' }, A)
    const link = await createField(
      orgId, clients.id,
      { name: 'Engagements', type: 'linked_record', options: { linkedTableId: eng.id } }, A,
    )
    const e1 = await createRecord(orgId, eng.id, { [start.id]: '2023-05-10' }, A)
    const e2 = await createRecord(orgId, eng.id, { [start.id]: '2021-11-03' }, A)
    const e3 = await createRecord(orgId, eng.id, { [start.id]: '2022-01-15' }, A)
    const since = await createField(
      orgId, clients.id,
      { name: 'Client Since', type: 'rollup',
        options: { recordLinkFieldId: link.id, targetFieldId: start.id, aggregate: 'min' } }, A,
    )
    const latest = await createField(
      orgId, clients.id,
      { name: 'Latest Start', type: 'rollup',
        options: { recordLinkFieldId: link.id, targetFieldId: start.id, aggregate: 'max' } }, A,
    )
    const client = await createRecord(
      orgId, clients.id, { [link.id]: [e1.id, e2.id, e3.id] }, A,
    )
    const read = await getRecordEnriched(orgId, clients.id, client.id)
    expect(read!.display[since.id]).toBe('2021-11-03')
    expect(read!.display[latest.id]).toBe('2023-05-10')
  })

  it('works over datetime fields and composes with filters', async () => {
    const clients = await createTable(orgId, { name: `D-DtC ${Math.random()}` }, A)
    await createField(orgId, clients.id, { name: 'Name', type: 'text' }, A)
    const eng = await createTable(orgId, { name: `D-Dt ${Math.random()}` }, A)
    const sent = await createField(orgId, eng.id, { name: 'Sent At', type: 'datetime' }, A)
    const done = await createField(orgId, eng.id, { name: 'Done', type: 'checkbox' }, A)
    const link = await createField(
      orgId, clients.id,
      { name: 'Cycles', type: 'linked_record', options: { linkedTableId: eng.id } }, A,
    )
    const e1 = await createRecord(
      orgId, eng.id, { [sent.id]: '2026-03-01T10:00:00Z', [done.id]: true }, A,
    )
    const e2 = await createRecord(
      orgId, eng.id, { [sent.id]: '2026-01-15T08:30:00Z', [done.id]: true }, A,
    )
    const e3 = await createRecord(
      orgId, eng.id, { [sent.id]: '2025-12-25T23:59:59Z', [done.id]: false }, A,
    )
    const firstDone = await createField(
      orgId, clients.id,
      { name: 'First done', type: 'rollup',
        options: {
          recordLinkFieldId: link.id, targetFieldId: sent.id, aggregate: 'min',
          filters: [{ fieldId: done.id, op: 'eq', value: true }],
        } }, A,
    )
    const client = await createRecord(orgId, clients.id, { [link.id]: [e1.id, e2.id, e3.id] }, A)
    const read = await getRecordEnriched(orgId, clients.id, client.id)
    // e3 is earlier but not Done; min over the filtered set is e2 (canonical ISO form).
    expect(read!.display[firstDone.id]).toBe(new Date('2026-01-15T08:30:00Z').toISOString())
  })
})
