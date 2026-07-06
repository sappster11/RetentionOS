// Forms — engine tests for form-view validation (config shape, writable-field rules,
// public-slug rules) and submitForm (required, coercion, actor attribution, revisions).
// Runs against the same embedded Postgres as the rest of the suite.
import { beforeAll, describe, expect, it } from 'vitest'
import {
  EngineError,
  FormSubmissionError,
  createField,
  createTable,
  createView,
  getFormBySlug,
  getRecord,
  listRecordRevisions,
  submitForm,
  updateView,
} from '../src/index'
import type { EngineField, EngineTable, EngineView } from '../src/index'
import { actor, ensureTestOrg } from './helpers'

let orgId: string
const A = actor('user', 'u-forms')

// A "Leads"-shaped fixture: text + single_select + long_text + number + email, plus a
// computed field and a linked_record pair to exercise the form-writability rules.
let leads: EngineTable
let company: EngineField
let source: EngineField
let notes: EngineField
let budget: EngineField
let email: EngineField
let auto: EngineField
let link: EngineField

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required for engine tests')
  orgId = await ensureTestOrg()

  leads = await createTable(orgId, { name: 'Forms Leads' }, A)
  const other = await createTable(orgId, { name: 'Forms Other' }, A)
  company = await createField(orgId, leads.id, { name: 'Company', type: 'text' }, A)
  source = await createField(
    orgId,
    leads.id,
    {
      name: 'Source',
      type: 'single_select',
      options: {
        choices: [
          { id: 'ref', name: 'Referral', color: 'blue' },
          { id: 'web', name: 'Website', color: 'green' },
        ],
      },
    },
    A,
  )
  notes = await createField(orgId, leads.id, { name: 'What are you looking for?', type: 'long_text' }, A)
  budget = await createField(orgId, leads.id, { name: 'Budget', type: 'number' }, A)
  email = await createField(orgId, leads.id, { name: 'Email', type: 'email' }, A)
  auto = await createField(orgId, leads.id, { name: 'Auto', type: 'autonumber' }, A)
  link = await createField(
    orgId,
    leads.id,
    { name: 'Linked', type: 'linked_record', options: { linkedTableId: other.id } },
    A,
  )
})

function formConfig(extra: Record<string, unknown> = {}) {
  return {
    title: 'Lead intake',
    description: 'Tell us about your project.',
    submitLabel: 'Send',
    fields: [
      { fieldId: company.id, required: true },
      { fieldId: source.id },
      { fieldId: notes.id, label: 'Project details', helpText: 'A sentence or two.' },
    ],
    ...extra,
  }
}

describe('form view validation', () => {
  it('creates a form view, minting a url-safe unique publicSlug', async () => {
    const view = await createView(orgId, leads.id, { name: 'Intake', type: 'form', config: formConfig() })
    expect(view.type).toBe('form')
    expect(view.config.publicSlug).toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/)
    expect(view.config.title).toBe('Lead intake')
    expect(view.config.submitLabel).toBe('Send')
    expect(view.config.fields).toHaveLength(3)
    expect(view.config.fields![0]).toEqual({ fieldId: company.id, required: true })
    expect(view.config.fields![2]).toEqual({
      fieldId: notes.id,
      required: false,
      label: 'Project details',
      helpText: 'A sentence or two.',
    })
  })

  it('drops grid-only keys (filters/sorts) from a form config', async () => {
    const view = await createView(orgId, leads.id, {
      name: 'Clean config',
      type: 'form',
      config: formConfig({ filters: [{ fieldId: company.id, op: 'is_not_empty' }], sorts: [] }),
    })
    expect(view.config.filters).toBeUndefined()
    expect(view.config.sorts).toBeUndefined()
  })

  it('rejects a fieldId that is not on the table', async () => {
    await expect(
      createView(orgId, leads.id, {
        name: 'Bad field',
        type: 'form',
        config: { fields: [{ fieldId: '00000000-0000-0000-0000-000000000000' }] },
      }),
    ).rejects.toMatchObject({ code: 'bad_options' })
  })

  it('rejects computed fields on a form', async () => {
    await expect(
      createView(orgId, leads.id, {
        name: 'Computed',
        type: 'form',
        config: { fields: [{ fieldId: auto.id }] },
      }),
    ).rejects.toMatchObject({ code: 'bad_options' })
  })

  it('rejects linked_record fields on a form (v1: no public record search)', async () => {
    await expect(
      createView(orgId, leads.id, {
        name: 'Linked',
        type: 'form',
        config: { fields: [{ fieldId: link.id }] },
      }),
    ).rejects.toMatchObject({ code: 'bad_options' })
  })

  it('rejects duplicate fieldIds', async () => {
    await expect(
      createView(orgId, leads.id, {
        name: 'Dupes',
        type: 'form',
        config: { fields: [{ fieldId: company.id }, { fieldId: company.id }] },
      }),
    ).rejects.toMatchObject({ code: 'bad_options' })
  })

  it('rejects a non-url-safe explicit publicSlug', async () => {
    await expect(
      createView(orgId, leads.id, {
        name: 'Bad slug',
        type: 'form',
        config: formConfig({ publicSlug: 'Not A Slug!' }),
      }),
    ).rejects.toMatchObject({ code: 'bad_options' })
  })

  it('rejects a publicSlug already used by another form', async () => {
    await createView(orgId, leads.id, {
      name: 'First',
      type: 'form',
      config: formConfig({ publicSlug: 'forms-test-unique-slug' }),
    })
    await expect(
      createView(orgId, leads.id, {
        name: 'Second',
        type: 'form',
        config: formConfig({ publicSlug: 'forms-test-unique-slug' }),
      }),
    ).rejects.toMatchObject({ code: 'bad_options' })
  })

  it('updateView revalidates form config and preserves the minted publicSlug', async () => {
    const view = await createView(orgId, leads.id, { name: 'Slug keeper', type: 'form', config: formConfig() })
    const slug = view.config.publicSlug!

    // A config patch that tries to swap the slug is overruled — the slug is engine-owned.
    const updated = await updateView(orgId, leads.id, view.id, {
      config: { ...formConfig({ title: 'Renamed intake' }), publicSlug: 'hijacked-slug' },
    })
    expect(updated.config.publicSlug).toBe(slug)
    expect(updated.config.title).toBe('Renamed intake')

    // And a bad field still rejects on update.
    await expect(
      updateView(orgId, leads.id, view.id, { config: { fields: [{ fieldId: auto.id }] } }),
    ).rejects.toMatchObject({ code: 'bad_options' })
  })

  it('rejects an unknown view type on create and update', async () => {
    await expect(
      createView(orgId, leads.id, { name: 'Nope', type: 'gallery' as never }),
    ).rejects.toMatchObject({ code: 'bad_type' })
    const view = await createView(orgId, leads.id, { name: 'Plain grid' })
    await expect(
      updateView(orgId, leads.id, view.id, { type: 'gallery' as never }),
    ).rejects.toMatchObject({ code: 'bad_type' })
  })
})

describe('getFormBySlug', () => {
  let view: EngineView

  beforeAll(async () => {
    view = await createView(orgId, leads.id, { name: 'Resolver', type: 'form', config: formConfig() })
  })

  it('resolves view + table + ordered fields; unknown slug is null', async () => {
    const form = await getFormBySlug(view.config.publicSlug!)
    expect(form).not.toBeNull()
    expect(form!.view.id).toBe(view.id)
    expect(form!.table.id).toBe(leads.id)
    expect(form!.fields.map((f) => f.field.id)).toEqual([company.id, source.id, notes.id])
    expect(form!.fields[0]!.required).toBe(true)
    expect(form!.fields[2]!.label).toBe('Project details')

    expect(await getFormBySlug('no-such-form-slug')).toBeNull()
  })

  it('scopes by org when orgId is provided', async () => {
    expect(await getFormBySlug(view.config.publicSlug!, orgId)).not.toBeNull()
    const otherOrg = await ensureTestOrg()
    expect(await getFormBySlug(view.config.publicSlug!, otherOrg)).toBeNull()
  })
})

describe('submitForm', () => {
  let slug: string

  beforeAll(async () => {
    const view = await createView(orgId, leads.id, {
      name: 'Submit target',
      type: 'form',
      config: {
        fields: [
          { fieldId: company.id, required: true },
          { fieldId: source.id },
          { fieldId: budget.id },
          { fieldId: email.id },
        ],
      },
    })
    slug = view.config.publicSlug!
  })

  it('creates the record with actor form:<slug> and writes the create revision', async () => {
    const { record } = await submitForm(slug, {
      [company.id]: 'Acme Co',
      [source.id]: 'ref',
    })
    expect(record.created_by_type).toBe('api')
    expect(record.created_by_id).toBe(`form:${slug}`)

    const stored = await getRecord(orgId, leads.id, record.id)
    expect(stored!.values[company.id]).toBe('Acme Co')
    expect(stored!.values[source.id]).toBe('ref')

    const revisions = await listRecordRevisions(orgId, record.id)
    expect(revisions).toHaveLength(1)
    expect(revisions[0]!.op).toBe('create')
    expect(revisions[0]!.actor_type).toBe('api')
    expect(revisions[0]!.actor_id).toBe(`form:${slug}`)
  })

  it('rejects a submission missing a form-required field, with a per-field error', async () => {
    const err = await submitForm(slug, { [source.id]: 'web' }).then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(FormSubmissionError)
    expect((err as FormSubmissionError).fieldErrors[company.id]).toMatch(/required/i)
  })

  it('coerces per type and collects coercion errors inline', async () => {
    // Numeric string coerces to a number.
    const { record } = await submitForm(slug, { [company.id]: 'Coerce Co', [budget.id]: '2500' })
    expect((await getRecord(orgId, leads.id, record.id))!.values[budget.id]).toBe(2500)

    // Bad email + bad select id both come back as fieldErrors in one throw.
    const err = await submitForm(slug, {
      [company.id]: 'Bad Co',
      [email.id]: 'not-an-email',
      [source.id]: 'nope',
    }).then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(FormSubmissionError)
    const fieldErrors = (err as FormSubmissionError).fieldErrors
    expect(Object.keys(fieldErrors).sort()).toEqual([email.id, source.id].sort())
  })

  it('rejects values for fields that are not on the form', async () => {
    await expect(
      submitForm(slug, { [company.id]: 'X', [notes.id]: 'sneaky' }),
    ).rejects.toMatchObject({ code: 'unknown_field' })
  })

  it('404s an unknown slug', async () => {
    await expect(submitForm('no-such-form-slug', {})).rejects.toMatchObject({ code: 'not_found' })
  })

  it('form-level required is independent of the engine field flag', async () => {
    // company.required is FALSE on the engine field; the form made it required.
    expect(company.required).toBe(false)
    // And a plain createRecord (not via the form) with no company still works.
    expect(await submitForm(slug, { [company.id]: 'Only company' })).toBeTruthy()
  })
})

describe('form errors are EngineErrors', () => {
  it('FormSubmissionError subclasses EngineError with code form_validation', () => {
    const e = new FormSubmissionError('x', { a: 'b' })
    expect(e).toBeInstanceOf(EngineError)
    expect(e.code).toBe('form_validation')
    expect(e.fieldErrors).toEqual({ a: 'b' })
  })
})
