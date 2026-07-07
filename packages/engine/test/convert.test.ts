// Lead → Client conversion tests (docs/09 "Sequenced delivery" item 2). Each fixture
// builds the seed-shaped Sales CRM + Client Hub tables in a FRESH org (convertLead
// resolves tables by slug, and slugs are unique per org), then drives convertLead
// through the happy path, the no-agreement path, idempotent re-convert, wrong-stage
// rejection, and missing-client-hub rejection.
import { beforeAll, describe, expect, it } from 'vitest'
import {
  EngineError,
  convertLead,
  createField,
  createRecord,
  createTable,
  getRecordEnriched,
  listFields,
  queryRecords,
} from '../src/index'
import type { EngineField, EngineTable } from '../src/index'
import { actor, ensureTestOrg } from './helpers'

const A = actor('user', 'converter')

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required for engine tests')
})

function sel(...cs: Array<[string, string]>) {
  return { choices: cs.map(([id, name]) => ({ id, name, color: 'gray' })) }
}

interface Fx {
  orgId: string
  leads: EngineTable
  contacts: EngineTable
  activities: EngineTable
  agreements: EngineTable
  clients: EngineTable
  engagements: EngineTable
  f: Record<string, EngineField>
}

/** Seed-shaped schema (field names/slugs match seed-salescrm + seed-clienthub). */
async function fixture(opts: { clientHub?: boolean } = {}): Promise<Fx> {
  const clientHub = opts.clientHub ?? true
  const orgId = await ensureTestOrg()
  const f: Record<string, EngineField> = {}

  const leads = await createTable(orgId, { name: 'Leads', slug: 'leads' }, A)
  const contacts = await createTable(orgId, { name: 'Contacts', slug: 'contacts' }, A)
  const activities = await createTable(orgId, { name: 'Activities', slug: 'activities' }, A)
  const agreements = await createTable(orgId, { name: 'Agreements', slug: 'agreements' }, A)

  f.company = await createField(orgId, leads.id, { name: 'Company', type: 'text' }, A)
  f.leadDomain = await createField(orgId, leads.id, { name: 'Domain', type: 'url' }, A)
  f.stage = await createField(
    orgId,
    leads.id,
    {
      name: 'Stage',
      type: 'single_select',
      options: sel(['new', 'New'], ['closed_won', 'Closed (Won)'], ['closed_lost', 'Closed (Lost)']),
    },
    A,
  )
  f.interested = await createField(
    orgId,
    leads.id,
    {
      name: 'Interested Services',
      type: 'multi_select',
      options: sel(['paid_social', 'Paid Social'], ['email_sms', 'Email/SMS'], ['retention', 'Retention']),
    },
    A,
  )
  f.contactsLink = await createField(
    orgId,
    leads.id,
    { name: 'Contacts', type: 'linked_record', options: { linkedTableId: contacts.id } },
    A,
  )
  f.activitiesLink = await createField(
    orgId,
    leads.id,
    { name: 'Activities', type: 'linked_record', options: { linkedTableId: activities.id } },
    A,
  )
  f.agreementLink = await createField(
    orgId,
    leads.id,
    { name: 'Agreement', type: 'linked_record', options: { linkedTableId: agreements.id } },
    A,
  )

  f.firstName = await createField(orgId, contacts.id, { name: 'First Name', type: 'text' }, A)

  f.actType = await createField(
    orgId,
    activities.id,
    { name: 'Type', type: 'single_select', options: sel(['call', 'Call'], ['note', 'Note']) },
    A,
  )
  f.actDate = await createField(orgId, activities.id, { name: 'Date', type: 'date' }, A)
  f.actSummary = await createField(orgId, activities.id, { name: 'Summary', type: 'text' }, A)

  f.agrStart = await createField(orgId, agreements.id, { name: 'Start Date', type: 'date' }, A)
  f.agrMinTerm = await createField(orgId, agreements.id, { name: 'Minimum Term', type: 'number' }, A)
  f.agrServices = await createField(
    orgId,
    agreements.id,
    {
      name: 'Services',
      type: 'multi_select',
      options: sel(['paid_social', 'Paid Social'], ['email_sms', 'Email/SMS'], ['direct_mail', 'Direct Mail']),
    },
    A,
  )
  f.agrPaidFee = await createField(orgId, agreements.id, { name: 'Paid Fee Base', type: 'currency' }, A)
  f.agrEmailFee = await createField(orgId, agreements.id, { name: 'Email Fee', type: 'currency' }, A)
  f.agrTiered = await createField(
    orgId,
    agreements.id,
    { name: 'Tiered Pricing Notes', type: 'long_text' },
    A,
  )

  let clients = null as EngineTable | null
  let engagements = null as EngineTable | null
  if (clientHub) {
    clients = await createTable(orgId, { name: 'Clients', slug: 'clients' }, A)
    engagements = await createTable(orgId, { name: 'Engagements', slug: 'engagements' }, A)

    f.clientName = await createField(orgId, clients.id, { name: 'Client', type: 'text' }, A)
    f.clientDomain = await createField(orgId, clients.id, { name: 'Domain', type: 'url' }, A)
    f.clientServices = await createField(
      orgId,
      clients.id,
      {
        name: 'Services',
        type: 'multi_select',
        options: sel(['paid_social', 'Paid Social'], ['email_sms', 'Email/SMS'], ['ugc', 'UGC']),
      },
      A,
    )
    f.clientStatus = await createField(
      orgId,
      clients.id,
      {
        name: 'Status',
        type: 'single_select',
        options: sel(['onboarding', 'Onboarding'], ['active', 'Active'], ['churned', 'Churned']),
      },
      A,
    )

    // The doc-10 Contacts extension: the Client link on the shared Contacts table.
    f.contactClientLink = await createField(
      orgId,
      contacts.id,
      { name: 'Client', type: 'linked_record', options: { linkedTableId: clients.id } },
      A,
    )

    f.engClientLink = await createField(
      orgId,
      engagements.id,
      { name: 'Client', type: 'linked_record', options: { linkedTableId: clients.id } },
      A,
    )
    f.engService = await createField(
      orgId,
      engagements.id,
      {
        name: 'Service',
        type: 'single_select',
        options: sel(['paid_social', 'Paid Social'], ['email_sms', 'Email/SMS'], ['direct_mail', 'Direct Mail']),
      },
      A,
    )
    f.engStart = await createField(orgId, engagements.id, { name: 'Start', type: 'date' }, A)
    f.engFee = await createField(orgId, engagements.id, { name: 'Monthly Fee', type: 'currency' }, A)
    f.engNotes = await createField(orgId, engagements.id, { name: 'Notes', type: 'long_text' }, A)
  }

  return {
    orgId,
    leads,
    contacts,
    activities,
    agreements,
    clients: clients as EngineTable,
    engagements: engagements as EngineTable,
    f,
  }
}

/** A Closed (Won) lead with a contact and (optionally) an agreement, ready to convert. */
async function seedLead(fx: Fx, opts: { agreement?: boolean } = {}) {
  const contact = await createRecord(fx.orgId, fx.contacts.id, { [fx.f.firstName!.id]: 'Pat' }, A)
  let agreement = null
  if (opts.agreement ?? true) {
    agreement = await createRecord(
      fx.orgId,
      fx.agreements.id,
      {
        [fx.f.agrStart!.id]: '2026-08-01',
        [fx.f.agrMinTerm!.id]: 6,
        [fx.f.agrServices!.id]: ['paid_social', 'email_sms'],
        [fx.f.agrPaidFee!.id]: 4000,
        [fx.f.agrEmailFee!.id]: 6500,
      },
      A,
    )
  }
  const lead = await createRecord(
    fx.orgId,
    fx.leads.id,
    {
      [fx.f.company!.id]: 'Acme Co',
      [fx.f.leadDomain!.id]: 'https://acme.example',
      [fx.f.stage!.id]: 'closed_won',
      [fx.f.interested!.id]: ['paid_social', 'email_sms', 'retention'],
      [fx.f.contactsLink!.id]: [contact.id],
      ...(agreement ? { [fx.f.agreementLink!.id]: [agreement.id] } : {}),
    },
    A,
  )
  return { lead, contact, agreement }
}

describe('convertLead — happy path', () => {
  it('creates the client, re-links contacts, materializes engagements, and logs the activity', async () => {
    const fx = await fixture()
    const { lead, contact } = await seedLead(fx)

    const result = await convertLead(fx.orgId, lead.id, A)

    expect(result.clientCreated).toBe(true)
    expect(result.clientTableId).toBe(fx.clients.id)
    expect(result.clientTableSlug).toBe('clients')
    expect(result.created).toEqual({
      client: 1,
      contactsRelinked: 1,
      engagements: 2,
      activities: 1,
    })
    // 'Retention' has no Clients Services counterpart — skipped and reported by name.
    expect(result.skipped.some((s) => s.includes('Retention'))).toBe(true)

    // Client record: name/domain/status/services (mapped by choice NAME).
    const client = await getRecordEnriched(fx.orgId, fx.clients.id, result.clientRecordId)
    expect(client).not.toBeNull()
    expect(client!.values[fx.f.clientName!.id]).toBe('Acme Co')
    expect(client!.values[fx.f.clientDomain!.id]).toBe('https://acme.example')
    expect(client!.values[fx.f.clientStatus!.id]).toBe('onboarding')
    expect(client!.values[fx.f.clientServices!.id]).toEqual(['paid_social', 'email_sms'])

    // Contact: linked to the client AND still linked to the lead.
    const freshContact = await getRecordEnriched(fx.orgId, fx.contacts.id, contact.id)
    expect(freshContact!.values[fx.f.contactClientLink!.id]).toEqual([result.clientRecordId])
    const contactFields = await listFields(fx.orgId, fx.contacts.id)
    const leadsInverse = contactFields.find(
      (f) => f.type === 'linked_record' && f.options.linkedTableId === fx.leads.id,
    )!
    expect(freshContact!.values[leadsInverse.id]).toEqual([lead.id])

    // Engagements: one per agreement service, fee per matched service, notes carry the term.
    const engs = await queryRecords(fx.orgId, fx.engagements.id, {})
    expect(engs.total).toBe(2)
    const byService = new Map(engs.records.map((r) => [r.values[fx.f.engService!.id], r]))
    const paid = byService.get('paid_social')!
    const email = byService.get('email_sms')!
    expect(paid.values[fx.f.engFee!.id]).toBe(4000)
    expect(email.values[fx.f.engFee!.id]).toBe(6500)
    for (const eng of [paid, email]) {
      expect(eng.values[fx.f.engClientLink!.id]).toEqual([result.clientRecordId])
      expect(eng.values[fx.f.engStart!.id]).toBe('2026-08-01')
      expect(String(eng.values[fx.f.engNotes!.id])).toContain('Minimum term: 6 months')
    }

    // Activity: Type Note, Summary 'Converted to client', linked to the lead.
    const acts = await queryRecords(fx.orgId, fx.activities.id, {})
    expect(acts.total).toBe(1)
    const act = acts.records[0]!
    expect(act.values[fx.f.actType!.id]).toBe('note')
    expect(act.values[fx.f.actSummary!.id]).toBe('Converted to client')
    const actFields = await listFields(fx.orgId, fx.activities.id)
    const leadLink = actFields.find(
      (f) => f.type === 'linked_record' && f.options.linkedTableId === fx.leads.id,
    )!
    expect(act.values[leadLink.id]).toEqual([lead.id])
  })
})

describe('convertLead — no agreement', () => {
  it('creates the client without engagements and reports the skip', async () => {
    const fx = await fixture()
    const { lead } = await seedLead(fx, { agreement: false })

    const result = await convertLead(fx.orgId, lead.id, A)

    expect(result.clientCreated).toBe(true)
    expect(result.created.engagements).toBe(0)
    expect(result.created.activities).toBe(1)
    expect(result.skipped.some((s) => s.toLowerCase().includes('no agreement'))).toBe(true)
    const engs = await queryRecords(fx.orgId, fx.engagements.id, {})
    expect(engs.total).toBe(0)
  })
})

describe('convertLead — idempotency', () => {
  it('re-converting reuses the existing client and creates no duplicates', async () => {
    const fx = await fixture()
    const { lead } = await seedLead(fx)

    const first = await convertLead(fx.orgId, lead.id, A)
    const second = await convertLead(fx.orgId, lead.id, A)

    expect(second.clientRecordId).toBe(first.clientRecordId)
    expect(second.clientCreated).toBe(false)
    expect(second.created).toEqual({
      client: 0,
      contactsRelinked: 0, // already linked on the first pass
      engagements: 0,
      activities: 0,
    })
    expect(second.skipped.some((s) => s.includes('already exists'))).toBe(true)

    // Still exactly one client, two engagements, one activity.
    expect((await queryRecords(fx.orgId, fx.clients.id, {})).total).toBe(1)
    expect((await queryRecords(fx.orgId, fx.engagements.id, {})).total).toBe(2)
    expect((await queryRecords(fx.orgId, fx.activities.id, {})).total).toBe(1)
  })

  it('matches an existing client case-insensitively', async () => {
    const fx = await fixture()
    const { lead } = await seedLead(fx, { agreement: false })
    const existing = await createRecord(
      fx.orgId,
      fx.clients.id,
      { [fx.f.clientName!.id]: 'ACME CO', [fx.f.clientStatus!.id]: 'active' },
      A,
    )

    const result = await convertLead(fx.orgId, lead.id, A)

    expect(result.clientCreated).toBe(false)
    expect(result.clientRecordId).toBe(existing.id)
    expect(result.created.client).toBe(0)
    // Contacts still get linked to the pre-existing client.
    expect(result.created.contactsRelinked).toBe(1)
    expect((await queryRecords(fx.orgId, fx.clients.id, {})).total).toBe(1)
  })
})

describe('convertLead — rejections', () => {
  it('rejects a lead whose Stage is not Closed (Won), with zero writes', async () => {
    const fx = await fixture()
    const lead = await createRecord(
      fx.orgId,
      fx.leads.id,
      { [fx.f.company!.id]: 'Not Yet Inc', [fx.f.stage!.id]: 'new' },
      A,
    )

    await expect(convertLead(fx.orgId, lead.id, A)).rejects.toMatchObject({
      code: 'bad_input',
      message: expect.stringContaining('Closed (Won)'),
    })
    expect((await queryRecords(fx.orgId, fx.clients.id, {})).total).toBe(0)
    expect((await queryRecords(fx.orgId, fx.activities.id, {})).total).toBe(0)
  })

  it('rejects clearly when the client hub has not been seeded', async () => {
    const fx = await fixture({ clientHub: false })
    const lead = await createRecord(
      fx.orgId,
      fx.leads.id,
      { [fx.f.company!.id]: 'Hubless LLC', [fx.f.stage!.id]: 'closed_won' },
      A,
    )

    await expect(convertLead(fx.orgId, lead.id, A)).rejects.toMatchObject({
      code: 'bad_input',
      message: expect.stringContaining('clients'),
    })
  })

  it('rejects a record id that is not a Leads row', async () => {
    const fx = await fixture()
    const contact = await createRecord(fx.orgId, fx.contacts.id, { [fx.f.firstName!.id]: 'Sam' }, A)

    await expect(convertLead(fx.orgId, contact.id, A)).rejects.toBeInstanceOf(EngineError)
    await expect(convertLead(fx.orgId, contact.id, A)).rejects.toMatchObject({ code: 'not_found' })
  })
})
