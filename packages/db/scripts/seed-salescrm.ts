// Sales CRM seed (docs/09-sales-crm.md) — the first real product configured ON the engine.
// Creates five tables (Leads, Contacts, Activities, Audit Handoffs, Agreements) with the
// full field set, the reference taxonomies (pulled verbatim from Jacob's Airtable SalesCRM),
// and the seeded views. ZERO records — Roam starts empty.
//
// Run: DATABASE_URL=postgres://... pnpm --filter @retentionos/db seed:salescrm
//
// Idempotent: tables are matched by slug, fields and views by name — re-running creates
// nothing. Built entirely through @retentionos/engine (the same service layer the UI, API,
// and agents use), so no SQL and no migrations.
//
// Known engine gaps this seed works around (docs/09 "noted, not blocking"):
//  - No relative-date filters: the Follow-ups view carries only the stage filters; the
//    "Next Action Due <= today" half becomes an engine fast-follow.
//  - Computed fields (created_time, autonumber) are not sortable/filterable in
//    queryRecords: All Leads is seeded without a sort (default order is created_at asc).
//  - No "is any of" filter op: Won / Lost review expresses "terminal stages only" as
//    is_not_empty + neq on each of the five active stages (AND-ed single-value ops).
//  - engine_fields has no description column: field descriptions (Minimum Term,
//    Est. Monthly Value) are stashed in options.description for a future UI surface.

import { getDefaultOrganization } from '../src/index'
import { queryOne } from '../src/pool'
import {
  createField,
  createTable,
  createView,
  getTableBySlug,
  listFields,
  listViews,
  updateField,
} from '@retentionos/engine'
import type {
  Actor,
  CreateFieldInput,
  EngineField,
  EngineTable,
  FieldOptions,
  ViewConfig,
  ViewType,
} from '@retentionos/engine'

const SEED_ACTOR: Actor = { type: 'user', id: 'seed' }

/** FieldOptions plus the description stash (options jsonb passes unknown keys through). */
type SeedFieldOptions = FieldOptions & { description?: string }

let tablesCreated = 0
let fieldsCreated = 0
let inverseFieldsCreated = 0
let viewsCreated = 0

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

async function ensureTable(
  orgId: string,
  input: { name: string; slug: string; icon: string; description: string },
): Promise<EngineTable> {
  const existing = await getTableBySlug(orgId, input.slug)
  if (existing) return existing
  tablesCreated += 1
  return createTable(orgId, input, SEED_ACTOR)
}

/** Create a field unless one with the same name already exists on the table. */
async function ensureField(
  orgId: string,
  tableId: string,
  input: CreateFieldInput,
): Promise<{ field: EngineField; created: boolean }> {
  const fields = await listFields(orgId, tableId)
  const existing = fields.find((f) => f.name === input.name)
  if (existing) return { field: existing, created: false }
  fieldsCreated += 1
  return { field: await createField(orgId, tableId, input, SEED_ACTOR), created: true }
}

/**
 * Create a linked_record field on `tableId` pointing at `targetTableId`. The engine
 * auto-creates the inverse on the target named after the source table ("Leads"); when the
 * spec wants a singular inverse name ("Lead"), rename it right after creation.
 */
async function ensureLink(
  orgId: string,
  tableId: string,
  name: string,
  targetTableId: string,
  inverseName?: string,
): Promise<EngineField> {
  const { field, created } = await ensureField(orgId, tableId, {
    name,
    type: 'linked_record',
    options: { linkedTableId: targetTableId },
  })
  if (created) {
    inverseFieldsCreated += 1
    if (inverseName && field.options.inverseFieldId) {
      await updateField(orgId, targetTableId, field.options.inverseFieldId, { name: inverseName })
    }
  }
  return field
}

async function ensureView(
  orgId: string,
  tableId: string,
  name: string,
  type: ViewType,
  config?: ViewConfig,
): Promise<void> {
  const views = await listViews(orgId, tableId)
  if (views.some((v) => v.name === name)) return
  viewsCreated += 1
  await createView(orgId, tableId, { name, type, config })
}

/** Shorthand for select options: [id, name, color] triples -> {choices}. */
function sel(...cs: Array<[string, string, string]>): FieldOptions {
  return { choices: cs.map(([id, name, color]) => ({ id, name, color })) }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.')
  const orgId = await ensureOrgId()

  // --- Tables (Leads first so it takes the first tab) --------------------------------
  const leads = await ensureTable(orgId, {
    name: 'Leads',
    slug: 'leads',
    icon: '🎯',
    description: 'Sales pipeline — one row per company from intake to close (docs/09).',
  })
  const contacts = await ensureTable(orgId, {
    name: 'Contacts',
    slug: 'contacts',
    icon: '👤',
    description: 'People at lead companies. Separate table so contacts survive lead→client conversion.',
  })
  const activities = await ensureTable(orgId, {
    name: 'Activities',
    slug: 'activities',
    icon: '📞',
    description: 'Calls, emails, meetings, and notes — the timeline on each lead.',
  })
  const audits = await ensureTable(orgId, {
    name: 'Audit Handoffs',
    slug: 'audit-handoffs',
    icon: '🔍',
    description: 'What the audit team needs when a lead reaches the Audit stage.',
  })
  const agreements = await ensureTable(orgId, {
    name: 'Agreements',
    slug: 'agreements',
    icon: '✍️',
    description: 'Signed service agreements — where the real economics live.',
  })

  // --- Contacts fields ----------------------------------------------------------------
  await ensureField(orgId, contacts.id, { name: 'First Name', type: 'text' })
  await ensureField(orgId, contacts.id, { name: 'Last Name', type: 'text' })
  await ensureField(orgId, contacts.id, { name: 'Email', type: 'email' })
  await ensureField(orgId, contacts.id, { name: 'Job Title', type: 'text' })
  await ensureField(orgId, contacts.id, { name: 'Notes', type: 'long_text' })
  // "Leads" auto-inverse link is created by the Leads-side link below.

  // --- Activities fields ----------------------------------------------------------------
  await ensureField(orgId, activities.id, {
    name: 'Type',
    type: 'single_select',
    options: sel(['call', 'Call', 'blue'], ['email', 'Email', 'cyan'], ['meeting', 'Meeting', 'purple'], ['note', 'Note', 'gray']),
  })
  await ensureField(orgId, activities.id, { name: 'Date', type: 'date' })
  await ensureField(orgId, activities.id, { name: 'Summary', type: 'text' })
  await ensureField(orgId, activities.id, { name: 'Detail', type: 'long_text' })

  // --- Audit Handoffs fields ------------------------------------------------------------
  await ensureField(orgId, audits.id, { name: 'Brand Name', type: 'text' })
  await ensureField(orgId, audits.id, {
    name: 'Auditing Services',
    type: 'multi_select',
    options: sel(['paid_social', 'Paid Social', 'blue'], ['retention', 'Retention', 'cyan']),
  })
  await ensureField(orgId, audits.id, {
    name: 'Platforms Needed',
    type: 'multi_select',
    options: sel(
      ['klaviyo', 'Klaviyo', 'teal'],
      ['shopify', 'Shopify', 'green'],
      ['meta', 'Meta', 'blue'],
      ['ga', 'GA', 'orange'],
      ['attentive', 'Attentive', 'yellow'],
      ['postscript', 'Postscript', 'purple'],
      ['motion', 'Motion', 'pink'],
      ['northbeam', 'Northbeam', 'red'],
      ['post_pilot', 'Post Pilot', 'cyan'],
      ['triple_whale', 'Triple Whale', 'blue'],
      ['other', 'Other', 'gray'],
    ),
  })
  await ensureField(orgId, audits.id, { name: 'Other Access Needed', type: 'text' })
  await ensureField(orgId, audits.id, {
    name: 'Priority',
    type: 'single_select',
    options: sel(['p1', '1', 'blue'], ['p2', '2', 'yellow'], ['p3', '3', 'red']),
  })
  await ensureField(orgId, audits.id, { name: 'Preferred Call Timing', type: 'text' })
  await ensureField(orgId, audits.id, { name: 'Call Notes', type: 'long_text' })
  await ensureField(orgId, audits.id, { name: 'Billing Notes', type: 'long_text' })

  // --- Agreements fields ------------------------------------------------------------------
  await ensureField(orgId, agreements.id, { name: 'Start Date', type: 'date' })
  await ensureField(orgId, agreements.id, { name: 'Signee Name', type: 'text' })
  await ensureField(orgId, agreements.id, { name: 'Signee Email', type: 'email' })
  await ensureField(orgId, agreements.id, { name: 'Invoice Email', type: 'email' })
  // The reference base mixed units here (and corrupted a currency field) — say it loud.
  const minimumTermOpts: SeedFieldOptions = { precision: 0, description: 'Always months' }
  await ensureField(orgId, agreements.id, {
    name: 'Minimum Term',
    type: 'number',
    options: minimumTermOpts,
  })
  await ensureField(orgId, agreements.id, {
    name: 'Services',
    type: 'multi_select',
    options: sel(['paid_social', 'Paid Social', 'blue'], ['email_sms', 'Email/SMS', 'green'], ['direct_mail', 'Direct Mail', 'orange']),
  })
  await ensureField(orgId, agreements.id, { name: 'Creative Included', type: 'checkbox' })
  await ensureField(orgId, agreements.id, {
    name: 'Paid Contract Type',
    type: 'single_select',
    options: sel(['flat_fee', 'Flat fee', 'green'], ['pct_ad_spend', '% of ad spend', 'orange']),
  })
  await ensureField(orgId, agreements.id, {
    name: 'Paid Fee Base',
    type: 'currency',
    options: { currencySymbol: '$' },
  })
  await ensureField(orgId, agreements.id, {
    name: 'Paid Social Monthly Cap',
    type: 'currency',
    options: { currencySymbol: '$' },
  })
  await ensureField(orgId, agreements.id, {
    name: 'Email Contract Type',
    type: 'single_select',
    options: sel(['flat_fee', 'Flat fee', 'purple'], ['tiered', 'Tiered', 'green']),
  })
  await ensureField(orgId, agreements.id, {
    name: 'Email Fee',
    type: 'currency',
    options: { currencySymbol: '$' },
  })
  await ensureField(orgId, agreements.id, { name: 'Tiered Pricing Notes', type: 'long_text' })
  await ensureField(orgId, agreements.id, { name: 'Call Notes', type: 'long_text' })

  // --- Leads fields (spec order; none marked required — a required field would break the
  // grid's "+ Add row", which creates an empty record. Required-at-intake/close are UI/agent
  // rules per docs/09.) ---------------------------------------------------------------------
  await ensureField(orgId, leads.id, { name: 'Company', type: 'text' })
  await ensureField(orgId, leads.id, { name: 'Domain', type: 'url' })
  const { field: stageF } = await ensureField(orgId, leads.id, {
    name: 'Stage',
    type: 'single_select',
    options: sel(
      ['new', 'New', 'blue'],
      ['contacted', 'Contacted', 'cyan'],
      ['discovery', 'Discovery', 'teal'],
      ['audit', 'Audit', 'yellow'],
      ['agreement', 'Agreement', 'orange'],
      ['closed_won', 'Closed (Won)', 'green'],
      ['closed_lost', 'Closed (Lost)', 'red'],
      ['passed', 'Passed', 'gray'],
    ),
  })
  await ensureField(orgId, leads.id, { name: 'On Hold', type: 'checkbox' })
  // Source taxonomy verbatim from the reference base's "Source Single Select".
  await ensureField(orgId, leads.id, {
    name: 'Source',
    type: 'single_select',
    options: sel(
      ['referred_client', 'Referred by existing client', 'blue'],
      ['word_of_mouth', 'Word of Mouth', 'gray'],
      ['klaviyo_community', 'Klaviyo Community', 'cyan'],
      ['twitter', 'Twitter', 'teal'],
      ['linkedin', 'LinkedIn', 'green'],
      ['podcast', 'Podcast', 'yellow'],
      ['newsletter', 'Newsletter', 'orange'],
      ['conference_event', 'Conference or Event', 'red'],
      ['agency_partner', 'Agency Partner', 'pink'],
      ['direct_search', 'Direct Search (Google)', 'purple'],
      ['chatgpt', 'ChatGPT', 'blue'],
      ['other', 'Other', 'gray'],
    ),
  })
  await ensureField(orgId, leads.id, {
    name: 'Interested Services',
    type: 'multi_select',
    options: sel(
      ['paid_social', 'Paid Social', 'blue'],
      ['email_sms', 'Email/SMS', 'cyan'],
      ['landing_pages', 'Landing Pages', 'teal'],
      ['direct_mail', 'Direct Mail', 'green'],
      ['retention', 'Retention', 'purple'],
      ['other', 'Other', 'gray'],
    ),
  })
  await ensureField(orgId, leads.id, {
    name: 'Company Type',
    type: 'single_select',
    options: sel(
      ['brand', 'Brand', 'blue'],
      ['saas_tech', 'SaaS/Tech', 'purple'],
      ['agency_consultant', 'Agency/Consultant', 'orange'],
      ['other', 'Other', 'gray'],
    ),
  })
  // Reference bands (the legacy "$25M+" duplicate band is dropped — superseded by the
  // finer $25M-$100M / $100M+ bands that replaced it in the reference base).
  await ensureField(orgId, leads.id, {
    name: 'Annual Revenue',
    type: 'single_select',
    options: sel(
      ['rev_0_500k', '$0 - $500k', 'blue'],
      ['rev_500k_1m', '$500k - $1M', 'cyan'],
      ['rev_1m_5m', '$1M - $5M', 'teal'],
      ['rev_5m_10m', '$5M - $10M', 'green'],
      ['rev_10m_25m', '$10M - $25M', 'yellow'],
      ['rev_25m_100m', '$25M - $100M', 'orange'],
      ['rev_100m_plus', '$100M+', 'red'],
    ),
  })
  await ensureField(orgId, leads.id, {
    name: 'Meta Spend',
    type: 'single_select',
    options: sel(
      ['spend_0_15k', '$0 - $15K', 'blue'],
      ['spend_15k_30k', '$15K - $30K', 'cyan'],
      ['spend_30k_100k', '$30K - $100K', 'teal'],
      ['spend_100k_500k', '$100K - $500K', 'green'],
      ['spend_500k_1m', '$500K - $1M', 'yellow'],
      ['spend_1m_plus', '$1M+', 'orange'],
    ),
  })
  await ensureField(orgId, leads.id, {
    name: 'Qualified',
    type: 'single_select',
    options: sel(['qualified', 'Qualified', 'green'], ['unqualified', 'Unqualified', 'red']),
  })
  await ensureField(orgId, leads.id, { name: 'What are you looking for?', type: 'long_text' })
  await ensureField(orgId, leads.id, { name: 'Expected Close', type: 'date' })
  const { field: confidenceF } = await ensureField(orgId, leads.id, {
    name: 'Confidence',
    type: 'percent',
  })
  const estValueOpts: SeedFieldOptions = {
    currencySymbol: '$',
    description: 'Forecast estimate — signed economics live on the Agreement',
  }
  const { field: estValueF } = await ensureField(orgId, leads.id, {
    name: 'Est. Monthly Value',
    type: 'currency',
    options: estValueOpts,
  })
  await ensureField(orgId, leads.id, {
    name: 'Weighted Value',
    type: 'formula',
    options: { expression: `{fld:${estValueF.id}} * {fld:${confidenceF.id}}` },
  })
  await ensureField(orgId, leads.id, { name: 'Next Action', type: 'text' })
  const { field: nextDueF } = await ensureField(orgId, leads.id, {
    name: 'Next Action Due',
    type: 'date',
  })
  await ensureField(orgId, leads.id, {
    name: 'Lost Reason',
    type: 'single_select',
    options: sel(
      ['stopped_responding', 'Stopped Responding', 'blue'],
      ['cost', 'Cost', 'yellow'],
      ['outside_icp', 'Outside of ICP', 'purple'],
      ['didnt_see_value', "Didn't see value", 'orange'],
      ['process_misalignment', 'Process Misalignment', 'red'],
      ['other', 'Other', 'gray'],
    ),
  })
  await ensureLink(orgId, leads.id, 'Contacts', contacts.id) // inverse keeps the auto "Leads" name
  await ensureLink(orgId, leads.id, 'Activities', activities.id, 'Lead')
  await ensureLink(orgId, leads.id, 'Audit Handoff', audits.id, 'Lead')
  await ensureLink(orgId, leads.id, 'Agreement', agreements.id, 'Lead')
  await ensureField(orgId, leads.id, { name: 'Lead #', type: 'autonumber' })
  await ensureField(orgId, leads.id, { name: 'Came In', type: 'created_time' })

  // --- Views ------------------------------------------------------------------------------
  const activeStages = ['new', 'contacted', 'discovery', 'audit', 'agreement']
  const terminalStages = ['closed_won', 'closed_lost', 'passed']

  await ensureView(orgId, leads.id, 'Pipeline', 'kanban', { groupByFieldId: stageF.id })
  // All Leads: docs/09 wants "sorted Came In desc", but computed fields (created_time,
  // autonumber) are rejected by queryRecords sorts — seeded unsorted (created_at asc default).
  await ensureView(orgId, leads.id, 'All Leads', 'grid')
  // Follow-ups: stage-not-terminal only; the "Next Action Due <= today" half needs
  // relative-date filters (engine fast-follow per docs/09).
  await ensureView(orgId, leads.id, 'Follow-ups', 'grid', {
    filters: terminalStages.map((id) => ({ fieldId: stageF.id, op: 'neq' as const, value: id })),
    sorts: [{ fieldId: nextDueF.id, direction: 'asc' }],
  })
  // Won / Lost review: no "is any of" op, so terminal-only = has a stage AND not any active one.
  await ensureView(orgId, leads.id, 'Won / Lost review', 'grid', {
    filters: [
      { fieldId: stageF.id, op: 'is_not_empty' as const },
      ...activeStages.map((id) => ({ fieldId: stageF.id, op: 'neq' as const, value: id })),
    ],
  })
  await ensureView(orgId, contacts.id, 'Grid', 'grid')
  await ensureView(orgId, activities.id, 'Grid', 'grid')
  await ensureView(orgId, audits.id, 'Grid', 'grid')
  await ensureView(orgId, agreements.id, 'Grid', 'grid')

  console.log(
    `Sales CRM seed complete: ${tablesCreated} tables, ${fieldsCreated} fields ` +
      `(+ ${inverseFieldsCreated} auto-inverse links), ${viewsCreated} views created.`,
  )
  if (tablesCreated + fieldsCreated + viewsCreated === 0) {
    console.log('Everything already present — nothing to do (idempotent re-run).')
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
