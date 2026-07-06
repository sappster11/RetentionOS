// Unit-level tests: import the tool handlers directly (no stdio transport) and drive the
// full agent workflow against a real embedded Postgres — build a schema (incl. a
// linked_record pair, a percent, a formula), write records, query with a filter, update,
// verify the audit trail shows the agent actor, and tear it all down.
import { beforeAll, describe, expect, it } from 'vitest'
import { queryOne } from '@retentionos/db'
import { getTool } from '../src/tools'

async function ensureTestOrg(): Promise<string> {
  const slug = `mcp-engine-test-${Math.random().toString(36).slice(2, 8)}`
  const row = await queryOne<{ id: string }>(
    `insert into public.organizations (name, slug) values ($1, $2) returning id`,
    ['MCP Engine Test Org', slug],
  )
  if (!row) throw new Error('Failed to create test org')
  return row.id
}

/** Call a tool handler and parse its JSON payload. Throws on unexpected tool errors. */
async function call(name: string, args: Record<string, unknown>): Promise<any> {
  const res = await getTool(name).run(args)
  const payload = JSON.parse(res.content[0]!.text)
  if (res.isError) throw new Error(`${name} failed: ${res.content[0]!.text}`)
  return payload
}

/** Call a tool expecting a mapped EngineError; returns the {code, message} error body. */
async function callExpectError(name: string, args: Record<string, unknown>): Promise<any> {
  const res = await getTool(name).run(args)
  expect(res.isError).toBe(true)
  return JSON.parse(res.content[0]!.text).error
}

let orgId: string

beforeAll(async () => {
  orgId = await ensureTestOrg()
})

describe('mcp-engine tools — schema building', () => {
  let dealsId: string
  let companiesId: string
  let nameF: string
  let amountF: string
  let probF: string
  let weightedF: string
  let stageF: string
  let companyNameF: string
  let linkF: string

  it('create_table creates Deals and Companies', async () => {
    const deals = await call('create_table', {
      name: 'Deals',
      icon: '📈',
      description: 'Sales pipeline',
      organization_id: orgId,
    })
    dealsId = deals.table.id
    expect(deals.table.slug).toBe('deals')
    expect(deals.table.created_by_type).toBe('agent')
    expect(deals.table.created_by_id).toBe('mcp-engine')

    const companies = await call('create_table', { name: 'Companies', organization_id: orgId })
    companiesId = companies.table.id
  })

  it('list_tables shows both', async () => {
    const { tables } = await call('list_tables', { organization_id: orgId })
    const names = tables.map((t: any) => t.name)
    expect(names).toContain('Deals')
    expect(names).toContain('Companies')
  })

  it('create_field: text, currency, percent, formula, single_select', async () => {
    nameF = (
      await call('create_field', {
        table: dealsId,
        name: 'Name',
        type: 'text',
        organization_id: orgId,
      })
    ).field.id
    amountF = (
      await call('create_field', {
        table: dealsId,
        name: 'Amount',
        type: 'currency',
        options: { currencySymbol: '$' },
        organization_id: orgId,
      })
    ).field.id
    probF = (
      await call('create_field', {
        table: dealsId,
        name: 'Probability',
        type: 'percent',
        organization_id: orgId,
      })
    ).field.id
    const weighted = await call('create_field', {
      table: dealsId,
      name: 'Weighted',
      type: 'formula',
      options: { expression: `{fld:${amountF}} * {fld:${probF}}` },
      organization_id: orgId,
    })
    weightedF = weighted.field.id
    expect(weighted.field.options.expression).toContain(amountF)

    stageF = (
      await call('create_field', {
        table: dealsId,
        name: 'Stage',
        type: 'single_select',
        options: {
          choices: [
            { id: 'open', name: 'Open', color: 'blue' },
            { id: 'won', name: 'Won', color: 'green' },
          ],
        },
        organization_id: orgId,
      })
    ).field.id

    companyNameF = (
      await call('create_field', {
        table: companiesId,
        name: 'Company Name',
        type: 'text',
        organization_id: orgId,
      })
    ).field.id
  })

  it('create_field linked_record auto-creates the inverse pair', async () => {
    const link = await call('create_field', {
      table: dealsId,
      name: 'Company',
      type: 'linked_record',
      options: { linkedTableId: companiesId },
      organization_id: orgId,
    })
    linkF = link.field.id
    expect(link.field.options.linkedTableId).toBe(companiesId)
    expect(link.field.options.inverseFieldId).toBeTruthy()

    // The inverse field exists on Companies and points back.
    const desc = await call('describe_table', { table: companiesId, organization_id: orgId })
    const inverse = desc.fields.find((f: any) => f.id === link.field.options.inverseFieldId)
    expect(inverse.type).toBe('linked_record')
    expect(inverse.options.linkedTableId).toBe(dealsId)
  })

  it('describe_table resolves by slug and by name, and carries everything a write needs', async () => {
    const bySlug = await call('describe_table', { table: 'deals', organization_id: orgId })
    expect(bySlug.table.id).toBe(dealsId)
    const byName = await call('describe_table', { table: 'DEALS', organization_id: orgId })
    expect(byName.table.id).toBe(dealsId)

    const stage = bySlug.fields.find((f: any) => f.id === stageF)
    expect(stage.options.choices.map((c: any) => c.id)).toEqual(['open', 'won'])
    const weighted = bySlug.fields.find((f: any) => f.id === weightedF)
    expect(weighted.options.expression).toBe(`{fld:${amountF}} * {fld:${probF}}`)
  })

  it('records: create → query with filter → update → display map', async () => {
    const company = await call('create_record', {
      table: companiesId,
      values: { [companyNameF]: 'Acme Co' },
      organization_id: orgId,
    })

    const big = await call('create_record', {
      table: 'deals',
      values: {
        [nameF]: 'Big deal',
        [amountF]: 50000,
        [probF]: '40%', // percent accepts a %-string, stored as 0.4
        [stageF]: 'open',
        [linkF]: [company.record.id],
      },
      organization_id: orgId,
    })
    expect(big.record.values[probF]).toBe(0.4)

    await call('create_record', {
      table: 'deals',
      values: { [nameF]: 'Small deal', [amountF]: 900, [probF]: 0.9, [stageF]: 'open' },
      organization_id: orgId,
    })

    // Filter: amount >= 1000 matches only the big deal.
    const q = await call('query_records', {
      table: 'deals',
      filters: [{ fieldId: amountF, op: 'gte', value: 1000 }],
      sorts: [{ fieldId: amountF, direction: 'desc' }],
      organization_id: orgId,
    })
    expect(q.total).toBe(1)
    expect(q.records[0].values[nameF]).toBe('Big deal')
    // display map: formula computed, linked record labeled.
    expect(q.records[0].display[weightedF]).toBe(20000)
    expect(q.records[0].display[linkF]).toEqual([{ id: company.record.id, label: 'Acme Co' }])

    // Stage change via update_record — this is what the revision trail must show.
    const upd = await call('update_record', {
      table: 'deals',
      record_id: big.record.id,
      values: { [stageF]: 'won' },
      organization_id: orgId,
    })
    expect(upd.record.values[stageF]).toBe('won')

    // get_record with revisions included.
    const got = await call('get_record', {
      table: 'deals',
      record_id: big.record.id,
      include_revisions: true,
      organization_id: orgId,
    })
    expect(got.record.display[weightedF]).toBe(20000)
    expect(got.revisions.length).toBe(2)

    // list_revisions: newest first, agent actor attribution, stage diff intact.
    const { revisions } = await call('list_revisions', {
      record_id: big.record.id,
      organization_id: orgId,
    })
    expect(revisions[0].op).toBe('update')
    expect(revisions[0].actor_type).toBe('agent')
    expect(revisions[0].actor_id).toBe('mcp-engine')
    expect(revisions[0].diff[stageF]).toEqual({ from: 'open', to: 'won' })
    expect(revisions[1].op).toBe('create')

    // delete_records logs the delete and reports the count.
    const del = await call('delete_records', {
      table: 'deals',
      record_ids: [big.record.id],
      organization_id: orgId,
    })
    expect(del.deleted).toBe(1)
    const afterDel = await call('list_revisions', {
      record_id: big.record.id,
      organization_id: orgId,
    })
    expect(afterDel.revisions[0].op).toBe('delete')
  })

  it('ROS_AGENT_ID distinguishes agents in the audit trail', async () => {
    process.env.ROS_AGENT_ID = 'test-agent-42'
    try {
      const rec = await call('create_record', {
        table: 'deals',
        values: { [nameF]: 'Attributed deal' },
        organization_id: orgId,
      })
      expect(rec.record.created_by_id).toBe('test-agent-42')
      const { revisions } = await call('list_revisions', {
        record_id: rec.record.id,
        organization_id: orgId,
      })
      expect(revisions[0].actor_id).toBe('test-agent-42')
    } finally {
      delete process.env.ROS_AGENT_ID
    }
  })

  it('views: create → list → update → delete', async () => {
    const view = await call('create_view', {
      table: 'deals',
      name: 'Pipeline',
      type: 'kanban',
      config: { groupByFieldId: stageF },
      organization_id: orgId,
    })
    expect(view.view.type).toBe('kanban')

    const { views } = await call('list_views', { table: 'deals', organization_id: orgId })
    expect(views.some((v: any) => v.name === 'Pipeline')).toBe(true)

    const renamed = await call('update_view', {
      table: 'deals',
      view_id: view.view.id,
      name: 'Pipeline Board',
      organization_id: orgId,
    })
    expect(renamed.view.name).toBe('Pipeline Board')

    const gone = await call('delete_view', {
      table: 'deals',
      view_id: view.view.id,
      organization_id: orgId,
    })
    expect(gone.deleted).toBe(true)
  })

  it('update_table / update_field patch only what is sent', async () => {
    const t = await call('update_table', {
      table: 'deals',
      description: 'Sales pipeline (updated)',
      organization_id: orgId,
    })
    expect(t.table.name).toBe('Deals')
    expect(t.table.description).toBe('Sales pipeline (updated)')

    const f = await call('update_field', {
      table: 'deals',
      field_id: nameF,
      name: 'Deal Name',
      organization_id: orgId,
    })
    expect(f.field.name).toBe('Deal Name')
    expect(f.field.type).toBe('text')
  })

  it('EngineError codes pass through the MCP error mapping intact', async () => {
    // Unknown table → not_found
    const nf = await callExpectError('describe_table', {
      table: 'no-such-table',
      organization_id: orgId,
    })
    expect(nf.code).toBe('not_found')

    // Bad select value → bad_value with the engine's message intact
    const desc = await call('describe_table', { table: 'deals', organization_id: orgId })
    const stage = desc.fields.find((f: any) => f.name === 'Stage')
    const bv = await callExpectError('create_record', {
      table: 'deals',
      values: { [stage.id]: 'bogus-choice' },
      organization_id: orgId,
    })
    expect(bv.code).toBe('bad_value')
    expect(bv.message).toContain('not a valid choice id')

    // Writing a computed field → bad_value
    const cw = await callExpectError('create_record', {
      table: 'deals',
      values: { [weightedF]: 123 },
      organization_id: orgId,
    })
    expect(cw.code).toBe('bad_value')
    expect(cw.message).toContain('computed')
  })

  it('delete_field removes a linked pair; delete_table cleans up', async () => {
    const before = await call('describe_table', { table: companiesId, organization_id: orgId })
    const inverseId = before.fields.find((f: any) => f.type === 'linked_record').id

    await call('delete_field', { table: 'deals', field_id: linkF, organization_id: orgId })
    const after = await call('describe_table', { table: companiesId, organization_id: orgId })
    expect(after.fields.some((f: any) => f.id === inverseId)).toBe(false)

    const delT = await call('delete_table', { table: companiesId, organization_id: orgId })
    expect(delT.deleted).toBe(true)
    const { tables } = await call('list_tables', { organization_id: orgId })
    expect(tables.some((t: any) => t.id === companiesId)).toBe(false)
  })
})

describe('mcp-engine tools — review-fix behaviors', () => {
  it('ambiguous name refs error with the matching ids; slug and id refs still resolve', async () => {
    const org = await ensureTestOrg()
    const a = await call('create_table', { name: 'Deals', organization_id: org })
    const b = await call('create_table', { name: 'deals', organization_id: org })
    expect(a.table.slug).toBe('deals')
    expect(b.table.slug).toBe('deals-2') // slug uniquing permits the name collision

    // A name ref matching both tables (case-insensitive) is ambiguous — never a guess.
    const err = await callExpectError('describe_table', { table: 'DEALS', organization_id: org })
    expect(err.code).toBe('ambiguous')
    expect(err.message).toContain(a.table.id)
    expect(err.message).toContain(b.table.id)

    // Applies to destructive tools too — nothing gets deleted on an ambiguous ref.
    const del = await callExpectError('delete_table', { table: 'DEALS', organization_id: org })
    expect(del.code).toBe('ambiguous')
    const { tables } = await call('list_tables', { organization_id: org })
    expect(tables.length).toBe(2)

    // Slug and id refs stay deterministic.
    const bySlug = await call('describe_table', { table: 'deals', organization_id: org })
    expect(bySlug.table.id).toBe(a.table.id)
    const bySlug2 = await call('describe_table', { table: 'deals-2', organization_id: org })
    expect(bySlug2.table.id).toBe(b.table.id)
    const byId = await call('describe_table', { table: b.table.id, organization_id: org })
    expect(byId.table.id).toBe(b.table.id)
  })

  it('run() validates args itself (transport-independent) — bad input → bad_input', async () => {
    const missing = await callExpectError('create_table', { organization_id: orgId })
    expect(missing.code).toBe('bad_input')
    expect(missing.message).toContain('name')

    const badLimit = await callExpectError('query_records', {
      table: 'whatever',
      limit: 0,
      organization_id: orgId,
    })
    expect(badLimit.code).toBe('bad_input')
    expect(badLimit.message).toContain('limit')
  })

  it('update_field round-trips unknown option keys (options passthrough)', async () => {
    const org = await ensureTestOrg()
    const t = await call('create_table', { name: 'Budget', organization_id: org })
    const f = await call('create_field', {
      table: t.table.id,
      name: 'Fee',
      type: 'currency',
      options: { currencySymbol: '$', description: 'Always monthly' },
      organization_id: org,
    })
    expect(f.field.options.description).toBe('Always monthly')

    // describe → update round-trip: send back exactly what describe returned; the unknown
    // "description" key must survive the tool-level schema parse instead of being stripped.
    const desc = await call('describe_table', { table: t.table.id, organization_id: org })
    const fee = desc.fields.find((x: any) => x.id === f.field.id)
    const upd = await call('update_field', {
      table: t.table.id,
      field_id: f.field.id,
      options: fee.options,
      organization_id: org,
    })
    expect(upd.field.options.description).toBe('Always monthly')
    expect(upd.field.options.currencySymbol).toBe('$')
  })

  it('RETENTIONOS_ORG_ID pins the server: a differing per-call org is forbidden', async () => {
    const pinnedOrg = await ensureTestOrg()
    const otherOrg = await ensureTestOrg()
    process.env.RETENTIONOS_ORG_ID = pinnedOrg
    try {
      const err = await callExpectError('list_tables', { organization_id: otherOrg })
      expect(err.code).toBe('forbidden')
      expect(err.message).toContain(pinnedOrg)

      // Same org as the pin, or omitted entirely → allowed (both resolve to the pin).
      const same = await call('list_tables', { organization_id: pinnedOrg })
      expect(same.tables).toEqual([])
      const omitted = await call('list_tables', {})
      expect(omitted.tables).toEqual([])
    } finally {
      delete process.env.RETENTIONOS_ORG_ID
    }
  })
})
