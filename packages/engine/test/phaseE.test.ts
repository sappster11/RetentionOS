// Phase E engine tests — (1) depth-2 lookup chaining: a lookup/rollup targetFieldId may be
// a LOOKUP on the directly-linked table whose own target resolves to a CONCRETE field one
// hop further (the docs/10 "Active PM shows the assignee's NAME" case), with the second hop
// batched like the first (no N+1) and deeper chains / rollup targets rejected; and
// (2) relative-date filter ops on_or_before_today / on_or_after_today — valueless,
// date/datetime only — in BOTH grammars: queryRecords' SQL path and the in-memory
// lookup/rollup link-filter matcher.
import { describe, expect, it, vi } from 'vitest'
import {
  EngineError,
  createField,
  createRecord,
  createTable,
  deleteField,
  getRecordEnriched,
  queryRecords,
} from '../src/index'
import { actor, ensureTestOrg } from './helpers'

// Count every SQL round-trip so the batching tests can assert query counts stay flat as
// the row count grows. The mock delegates to the real @retentionos/db verbatim.
const counted = vi.hoisted(() => ({ n: 0 }))
vi.mock('@retentionos/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@retentionos/db')>()
  return {
    ...actual,
    query: (...args: Parameters<typeof actual.query>) => {
      counted.n += 1
      return actual.query(...args)
    },
    queryOne: (...args: Parameters<typeof actual.queryOne>) => {
      counted.n += 1
      return actual.queryOne(...args)
    },
  }
})

const A = actor('user', 'u-1')

// beforeAll can't run before vi.mock's hoisting anyway; create the org lazily per fixture.
let orgIdPromise: Promise<string> | null = null
function org(): Promise<string> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required for engine tests')
  orgIdPromise ??= ensureTestOrg()
  return orgIdPromise
}

/**
 * The docs/10 shape, one hop longer than phaseD's: Clients →(link)→ Assignments →(link)→
 * Team Members. Assignments carries a helper LOOKUP "Team Member Name" (→ Team Members.Name),
 * and the depth-2 fields on Clients chain through it.
 */
async function fixture() {
  const orgId = await org()
  const team = await createTable(orgId, { name: `E-Team ${Math.random()}` }, A)
  const tmName = await createField(orgId, team.id, { name: 'Name', type: 'text' }, A)
  const tmRate = await createField(orgId, team.id, { name: 'Rate', type: 'number' }, A)

  const asg = await createTable(orgId, { name: `E-Assignments ${Math.random()}` }, A)
  const role = await createField(
    orgId, asg.id,
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
  const tmLink = await createField(
    orgId, asg.id,
    { name: 'Team Member', type: 'linked_record', options: { linkedTableId: team.id } }, A,
  )
  const tmNameLookup = await createField(
    orgId, asg.id,
    { name: 'Team Member Name', type: 'lookup',
      options: { recordLinkFieldId: tmLink.id, targetFieldId: tmName.id } }, A,
  )

  const clients = await createTable(orgId, { name: `E-Clients ${Math.random()}` }, A)
  await createField(orgId, clients.id, { name: 'Client', type: 'text' }, A)
  const asgLink = await createField(
    orgId, clients.id,
    { name: 'Assignments', type: 'linked_record', options: { linkedTableId: asg.id } }, A,
  )
  return { orgId, team, tmName, tmRate, asg, role, end, tmLink, tmNameLookup, clients, asgLink }
}

type Fx = Awaited<ReturnType<typeof fixture>>

/** Team members Sara/Bram/Cleo; assignments: Sara active PM, Bram ended PM, Cleo active ST. */
async function seedPeople(f: Fx) {
  const sara = await createRecord(f.orgId, f.team.id, { [f.tmName.id]: 'Sara', [f.tmRate.id]: 100 }, A)
  const bram = await createRecord(f.orgId, f.team.id, { [f.tmName.id]: 'Bram', [f.tmRate.id]: 80 }, A)
  const cleo = await createRecord(f.orgId, f.team.id, { [f.tmName.id]: 'Cleo', [f.tmRate.id]: 90 }, A)
  const a1 = await createRecord(
    f.orgId, f.asg.id, { [f.role.id]: 'pm', [f.tmLink.id]: [sara.id] }, A,
  )
  const a2 = await createRecord(
    f.orgId, f.asg.id, { [f.role.id]: 'pm', [f.end.id]: '2025-02-01', [f.tmLink.id]: [bram.id] }, A,
  )
  const a3 = await createRecord(
    f.orgId, f.asg.id, { [f.role.id]: 'st', [f.tmLink.id]: [cleo.id] }, A,
  )
  return { sara, bram, cleo, a1, a2, a3 }
}

describe('depth-2 lookup chaining — compute', () => {
  it('a lookup targeting a hop-1 lookup pulls the hop-2 values (flattened, link order)', async () => {
    const f = await fixture()
    const { a1, a2, a3 } = await seedPeople(f)
    const names = await createField(
      f.orgId, f.clients.id,
      { name: 'Team Names', type: 'lookup',
        options: { recordLinkFieldId: f.asgLink.id, targetFieldId: f.tmNameLookup.id } }, A,
    )
    const client = await createRecord(
      f.orgId, f.clients.id, { [f.asgLink.id]: [a1.id, a2.id, a3.id] }, A,
    )
    const read = await getRecordEnriched(f.orgId, f.clients.id, client.id)
    expect(read!.display[names.id]).toEqual(['Sara', 'Bram', 'Cleo'])
  })

  it('the Active-PM case: filtered concat rollup through the chained lookup shows the NAME', async () => {
    const f = await fixture()
    const { a1, a2, a3 } = await seedPeople(f)
    const activePM = await createField(
      f.orgId, f.clients.id,
      { name: 'Active PM', type: 'rollup',
        options: {
          recordLinkFieldId: f.asgLink.id,
          targetFieldId: f.tmNameLookup.id,
          aggregate: 'concat',
          filters: [
            { fieldId: f.end.id, op: 'is_empty' },
            { fieldId: f.role.id, op: 'eq', value: 'pm' },
          ],
        } }, A,
    )
    const client = await createRecord(
      f.orgId, f.clients.id, { [f.asgLink.id]: [a1.id, a2.id, a3.id] }, A,
    )
    const read = await getRecordEnriched(f.orgId, f.clients.id, client.id)
    expect(read!.display[activePM.id]).toBe('Sara') // Bram's assignment ended; Cleo is ST
  })

  it('numeric aggregates through the chain type off the FINAL field (sum of hop-2 rates)', async () => {
    const f = await fixture()
    const { a1, a2, a3 } = await seedPeople(f)
    const rateLookup = await createField(
      f.orgId, f.asg.id,
      { name: 'Rate lookup', type: 'lookup',
        options: { recordLinkFieldId: f.tmLink.id, targetFieldId: f.tmRate.id } }, A,
    )
    const totalRate = await createField(
      f.orgId, f.clients.id,
      { name: 'Total rate', type: 'rollup',
        options: { recordLinkFieldId: f.asgLink.id, targetFieldId: rateLookup.id, aggregate: 'sum' } }, A,
    )
    const client = await createRecord(
      f.orgId, f.clients.id, { [f.asgLink.id]: [a1.id, a2.id, a3.id] }, A,
    )
    const read = await getRecordEnriched(f.orgId, f.clients.id, client.id)
    expect(read!.display[totalRate.id]).toBe(270) // 100 + 80 + 90
  })

  it('an assignment with NO team member contributes nothing; empty semantics unchanged', async () => {
    const f = await fixture()
    const bare = await createRecord(f.orgId, f.asg.id, { [f.role.id]: 'pm' }, A) // no Team Member
    const names = await createField(
      f.orgId, f.clients.id,
      { name: 'Team Names', type: 'lookup',
        options: { recordLinkFieldId: f.asgLink.id, targetFieldId: f.tmNameLookup.id } }, A,
    )
    const concat = await createField(
      f.orgId, f.clients.id,
      { name: 'Names concat', type: 'rollup',
        options: { recordLinkFieldId: f.asgLink.id, targetFieldId: f.tmNameLookup.id, aggregate: 'concat' } }, A,
    )
    const client = await createRecord(f.orgId, f.clients.id, { [f.asgLink.id]: [bare.id] }, A)
    const read = await getRecordEnriched(f.orgId, f.clients.id, client.id)
    expect(read!.display[names.id]).toEqual([])
    expect(read!.display[concat.id]).toBe('')
  })
})

describe('depth-2 lookup chaining — validation', () => {
  it('accepts a lookup target whose own target is concrete; rejects a deeper chain', async () => {
    const f = await fixture()
    // Chain-of-chains: a lookup on Assignments targeting ANOTHER lookup two tables away.
    // Build: Clients gets "Team Names" (valid depth-2), then a second Clients-side table
    // linking to Clients tries to look THROUGH "Team Names" — 3 hops — rejected.
    const teamNames = await createField(
      f.orgId, f.clients.id,
      { name: 'Team Names', type: 'lookup',
        options: { recordLinkFieldId: f.asgLink.id, targetFieldId: f.tmNameLookup.id } }, A,
    )
    const accounts = await createTable(f.orgId, { name: `E-Accounts ${Math.random()}` }, A)
    const clientLink = await createField(
      f.orgId, accounts.id,
      { name: 'Client', type: 'linked_record', options: { linkedTableId: f.clients.id } }, A,
    )
    await expect(
      createField(
        f.orgId, accounts.id,
        { name: 'too deep', type: 'lookup',
          options: { recordLinkFieldId: clientLink.id, targetFieldId: teamNames.id } }, A,
      ),
    ).rejects.toThrow(/at most ONE lookup/)
  })

  it('rejects rollup and formula targets (only lookup targets may chain)', async () => {
    const f = await fixture()
    const count = await createField(
      f.orgId, f.asg.id,
      { name: 'TM count', type: 'rollup',
        options: { recordLinkFieldId: f.tmLink.id, aggregate: 'count' } }, A,
    )
    await expect(
      createField(
        f.orgId, f.clients.id,
        { name: 'bad', type: 'lookup',
          options: { recordLinkFieldId: f.asgLink.id, targetFieldId: count.id } }, A,
      ),
    ).rejects.toThrow(/must be a concrete field, or a lookup/)
    await expect(
      createField(
        f.orgId, f.clients.id,
        { name: 'bad2', type: 'rollup',
          options: { recordLinkFieldId: f.asgLink.id, targetFieldId: count.id, aggregate: 'concat' } }, A,
      ),
    ).rejects.toThrow(/must be a concrete field, or a lookup/)
  })
})

describe('depth-2 lookup chaining — stale fields (either hop deleted → empty)', () => {
  it('deleting the hop-2 target (Team Members.Name) empties the chained values, no crash', async () => {
    const f = await fixture()
    const { a1 } = await seedPeople(f)
    const names = await createField(
      f.orgId, f.clients.id,
      { name: 'Team Names', type: 'lookup',
        options: { recordLinkFieldId: f.asgLink.id, targetFieldId: f.tmNameLookup.id } }, A,
    )
    const concat = await createField(
      f.orgId, f.clients.id,
      { name: 'Names concat', type: 'rollup',
        options: { recordLinkFieldId: f.asgLink.id, targetFieldId: f.tmNameLookup.id, aggregate: 'concat' } }, A,
    )
    const client = await createRecord(f.orgId, f.clients.id, { [f.asgLink.id]: [a1.id] }, A)
    let read = await getRecordEnriched(f.orgId, f.clients.id, client.id)
    expect(read!.display[names.id]).toEqual(['Sara'])

    await deleteField(f.orgId, f.team.id, f.tmName.id)
    read = await getRecordEnriched(f.orgId, f.clients.id, client.id)
    expect(read!.display[names.id]).toEqual([])
    expect(read!.display[concat.id]).toBe('')
  })

  it('deleting the hop-1 chained lookup itself empties the outer field, no crash', async () => {
    const f = await fixture()
    const { a1 } = await seedPeople(f)
    const names = await createField(
      f.orgId, f.clients.id,
      { name: 'Team Names', type: 'lookup',
        options: { recordLinkFieldId: f.asgLink.id, targetFieldId: f.tmNameLookup.id } }, A,
    )
    const client = await createRecord(f.orgId, f.clients.id, { [f.asgLink.id]: [a1.id] }, A)
    await deleteField(f.orgId, f.asg.id, f.tmNameLookup.id)
    const read = await getRecordEnriched(f.orgId, f.clients.id, client.id)
    expect(read!.display[names.id]).toEqual([])
  })
})

describe('depth-2 lookup chaining — batching (no N+1)', () => {
  it('query count stays flat as linked rows double', async () => {
    const f = await fixture()
    await createField(
      f.orgId, f.clients.id,
      { name: 'Team Names', type: 'lookup',
        options: { recordLinkFieldId: f.asgLink.id, targetFieldId: f.tmNameLookup.id } }, A,
    )
    async function clientWithAssignments(n: number): Promise<string> {
      const asgIds: string[] = []
      for (let i = 0; i < n; i++) {
        const tm = await createRecord(f.orgId, f.team.id, { [f.tmName.id]: `P${i}` }, A)
        const a = await createRecord(f.orgId, f.asg.id, { [f.tmLink.id]: [tm.id] }, A)
        asgIds.push(a.id)
      }
      const c = await createRecord(f.orgId, f.clients.id, { [f.asgLink.id]: asgIds }, A)
      return c.id
    }
    const small = await clientWithAssignments(2)
    const large = await clientWithAssignments(6)

    counted.n = 0
    await getRecordEnriched(f.orgId, f.clients.id, small)
    const smallQueries = counted.n
    counted.n = 0
    await getRecordEnriched(f.orgId, f.clients.id, large)
    const largeQueries = counted.n

    expect(smallQueries).toBeGreaterThan(0)
    expect(largeQueries).toBe(smallQueries) // batched at BOTH hops — flat in row count
  })
})

describe('relative-date ops — SQL path (queryRecords)', () => {
  async function dateFixture() {
    const orgId = await org()
    const t = await createTable(orgId, { name: `E-Due ${Math.random()}` }, A)
    const name = await createField(orgId, t.id, { name: 'Name', type: 'text' }, A)
    const due = await createField(orgId, t.id, { name: 'Due', type: 'date' }, A)
    const at = await createField(orgId, t.id, { name: 'At', type: 'datetime' }, A)
    // LOCAL calendar dates (Postgres current_date is the DB server's local date, and the
    // embedded test server shares this machine's clock) — a UTC slice would go flaky in
    // the evening/morning hours whenever UTC and local disagree on "today".
    const iso = (d: Date) => {
      const p = (n: number) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    }
    const past = new Date(Date.now() - 3 * 864e5)
    const future = new Date(Date.now() + 3 * 864e5)
    const today = new Date()
    await createRecord(orgId, t.id, { [name.id]: 'past', [due.id]: iso(past), [at.id]: past.toISOString() }, A)
    await createRecord(orgId, t.id, { [name.id]: 'today', [due.id]: iso(today) }, A)
    await createRecord(orgId, t.id, { [name.id]: 'future', [due.id]: iso(future), [at.id]: future.toISOString() }, A)
    await createRecord(orgId, t.id, { [name.id]: 'blank' }, A) // Due/At empty → never matches
    return { orgId, t, name, due, at }
  }

  it('on_or_before_today / on_or_after_today on a DATE field compare by calendar date', async () => {
    const f = await dateFixture()
    const before = await queryRecords(f.orgId, f.t.id, {
      filters: [{ fieldId: f.due.id, op: 'on_or_before_today' }],
    })
    expect(before.records.map((r) => r.values[f.name.id]).sort()).toEqual(['past', 'today'])
    const after = await queryRecords(f.orgId, f.t.id, {
      filters: [{ fieldId: f.due.id, op: 'on_or_after_today' }],
    })
    expect(after.records.map((r) => r.values[f.name.id]).sort()).toEqual(['future', 'today'])
  })

  it('on a DATETIME field compares by instant vs now; empty values never match', async () => {
    const f = await dateFixture()
    const before = await queryRecords(f.orgId, f.t.id, {
      filters: [{ fieldId: f.at.id, op: 'on_or_before_today' }],
    })
    expect(before.records.map((r) => r.values[f.name.id])).toEqual(['past'])
    const after = await queryRecords(f.orgId, f.t.id, {
      filters: [{ fieldId: f.at.id, op: 'on_or_after_today' }],
    })
    expect(after.records.map((r) => r.values[f.name.id])).toEqual(['future'])
  })

  it('rejects non-date fields and a supplied value', async () => {
    const f = await dateFixture()
    await expect(
      queryRecords(f.orgId, f.t.id, { filters: [{ fieldId: f.name.id, op: 'on_or_before_today' }] }),
    ).rejects.toThrow(/only applies to date\/datetime/)
    await expect(
      queryRecords(f.orgId, f.t.id, {
        filters: [{ fieldId: f.due.id, op: 'on_or_after_today', value: '2026-01-01' }],
      }),
    ).rejects.toThrow(/does not take a value/)
  })
})

describe('relative-date ops — in-memory path (lookup/rollup link filters)', () => {
  it('a rollup filtered by on_or_before_today counts only due/overdue linked rows', async () => {
    const f = await fixture()
    // Local dates ±2/+5 days: far enough out that UTC-vs-local "today" can't blur them.
    const iso = (d: Date) => {
      const p = (n: number) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    }
    const overdue = await createRecord(
      f.orgId, f.asg.id, { [f.end.id]: iso(new Date(Date.now() - 2 * 864e5)) }, A,
    )
    const upcoming = await createRecord(
      f.orgId, f.asg.id, { [f.end.id]: iso(new Date(Date.now() + 5 * 864e5)) }, A,
    )
    const blank = await createRecord(f.orgId, f.asg.id, {}, A) // End empty → never matches
    const dueCount = await createField(
      f.orgId, f.clients.id,
      { name: 'Ended by today', type: 'rollup',
        options: {
          recordLinkFieldId: f.asgLink.id,
          aggregate: 'count',
          filters: [{ fieldId: f.end.id, op: 'on_or_before_today' }],
        } }, A,
    )
    const notYet = await createField(
      f.orgId, f.clients.id,
      { name: 'Ends today or later', type: 'rollup',
        options: {
          recordLinkFieldId: f.asgLink.id,
          aggregate: 'count',
          filters: [{ fieldId: f.end.id, op: 'on_or_after_today' }],
        } }, A,
    )
    const client = await createRecord(
      f.orgId, f.clients.id, { [f.asgLink.id]: [overdue.id, upcoming.id, blank.id] }, A,
    )
    const read = await getRecordEnriched(f.orgId, f.clients.id, client.id)
    expect(read!.display[dueCount.id]).toBe(1) // only the overdue row
    expect(read!.display[notYet.id]).toBe(1) // only the upcoming row
  })

  it('link-filter validation: relative ops are valueless and date/datetime-only', async () => {
    const f = await fixture()
    await expect(
      createField(
        f.orgId, f.clients.id,
        { name: 'bad', type: 'rollup',
          options: {
            recordLinkFieldId: f.asgLink.id,
            aggregate: 'count',
            filters: [{ fieldId: f.role.id, op: 'on_or_before_today' }],
          } }, A,
      ),
    ).rejects.toThrow(/only applies to date\/datetime/)
    await expect(
      createField(
        f.orgId, f.clients.id,
        { name: 'bad2', type: 'rollup',
          options: {
            recordLinkFieldId: f.asgLink.id,
            aggregate: 'count',
            filters: [{ fieldId: f.end.id, op: 'on_or_after_today', value: 'x' } as never],
          } }, A,
      ),
    ).rejects.toThrow(/does not take a value/)
  })

  it('EngineError shape: bad relative-op usage is caller-fixable (bad_filter/bad_options)', async () => {
    const f = await fixture()
    const err = await queryRecords(f.orgId, f.clients.id, {
      filters: [{ fieldId: f.asgLink.id, op: 'on_or_before_today' }],
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(EngineError)
  })
})
