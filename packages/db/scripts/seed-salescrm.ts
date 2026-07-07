// Sales CRM seed (docs/09-sales-crm.md) — the first real product configured ON the engine.
// Creates five tables (Leads, Contacts, Activities, Audit Handoffs, Agreements) with the
// full field set, the reference taxonomies (pulled verbatim from Jacob's Airtable SalesCRM),
// and the seeded views. ZERO records — Roam starts empty.
//
// Run: DATABASE_URL=postgres://... pnpm --filter @retentionos/db seed:salescrm
//
// Idempotency: tables are matched by slug, fields and views by name — rerunning a completed
// seed creates nothing. That holds only while the seeded tables/fields/views KEEP their
// names: rename one and rerun, and the seed creates a fresh parallel field/view under the
// original name (by design — the seed never guesses that a renamed thing is "its" field).
// When a same-name field/view already exists, its type (and, for links, the target table)
// must match what the seed expects; on mismatch the seed ABORTS before creating anything —
// it never silently adopts a wrong-typed field. All existence/type checks run in a
// validate pass before any writes (two-phase: validate, then create), so a conflict can
// never leave a half-seeded table behind. Built entirely through @retentionos/engine (the
// same service layer the UI, API, and agents use), so no SQL and no migrations.
//
// Known engine gaps this seed works around (docs/09 "noted, not blocking"):
//  - CLOSED: relative-date filters. Follow-ups now carries the "Next Action Due <= today"
//    half as an on_or_before_today condition (evaluated at read time, never stale);
//    deployments seeded before the op existed gain the condition on rerun.
//  - Computed fields (created_time, autonumber) are not sortable/filterable in
//    queryRecords: All Leads is seeded without a sort (default order is created_at asc).
//  - No "is any of" filter op: Won / Lost review expresses "terminal stages only" as
//    is_not_empty + neq on each of the five active stages (AND-ed single-value ops).
//  - engine_fields has no description column: field descriptions (Minimum Term,
//    Est. Monthly Value) are stashed in options.description for a future UI surface.

import { getDefaultOrganization } from '../src/index'
import { queryOne } from '../src/pool'
import {
  createBase,
  createField,
  createTable,
  createView,
  getBaseBySlug,
  getTableBySlug,
  listFields,
  listViews,
  updateField,
  updateTable,
  updateView,
} from '@retentionos/engine'
import type {
  Actor,
  CreateFieldInput,
  EngineField,
  EngineTable,
  FieldOptions,
  FilterCondition,
  ViewConfig,
  ViewType,
} from '@retentionos/engine'

const SEED_ACTOR: Actor = { type: 'user', id: 'seed' }

/** FieldOptions plus the description stash (options jsonb passes unknown keys through). */
type SeedFieldOptions = FieldOptions & { description?: string }

let basesCreated = 0
let tablesCreated = 0
let tablesAdopted = 0
let fieldsCreated = 0
let inverseFieldsCreated = 0
let viewsCreated = 0

// Two-phase execution: the whole seed body runs twice. The 'validate' pass creates
// NOTHING — it only checks every existing same-name field/view against the expected
// type/link-target and collects conflicts. Only if the validate pass is clean does the
// 'create' pass run and write whatever is missing. Not-yet-existing tables get a
// "pending:" sentinel id in the validate pass (nothing inside them can conflict).
type SeedPhase = 'validate' | 'create'
let phase: SeedPhase = 'validate'
const conflicts: string[] = []
const tableNames = new Map<string, string>()

const isPendingId = (id: string) => id.startsWith('pending:')

/** Placeholder returned by the validate pass for things that don't exist yet. Its id is
 * only ever interpolated into configs that the validate pass never persists. */
function stubField(input: CreateFieldInput): EngineField {
  return {
    id: `pending:field:${input.name}`,
    name: input.name,
    type: input.type,
    options: input.options ?? {},
  } as unknown as EngineField
}

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

/** Ensure the seed's base exists (matched by slug). Existing base wins — its name/icon are
 * never overwritten. The validate pass creates nothing ("pending:" sentinel). */
async function ensureBase(
  orgId: string,
  input: { name: string; slug: string; icon: string },
): Promise<string> {
  const existing = await getBaseBySlug(orgId, input.slug)
  if (existing) return existing.id
  if (phase === 'validate') return `pending:base:${input.slug}`
  basesCreated += 1
  const created = await createBase(orgId, input, SEED_ACTOR)
  return created.id
}

/** Ensure a table exists (matched by slug) INSIDE the given base. A pre-existing table
 * with base_id NULL is ADOPTED into the base (this is the backfill path for deployments
 * that seeded before bases existed); a table already in some base — this one or one the
 * user moved it to — is left alone. Adoption happens only in the create pass (the
 * validate pass makes zero writes) and only fills NULL, so it can't conflict. */
async function ensureTable(
  orgId: string,
  baseId: string,
  input: { name: string; slug: string; icon: string; description: string },
): Promise<EngineTable> {
  const existing = await getTableBySlug(orgId, input.slug)
  if (existing) {
    tableNames.set(existing.id, existing.name)
    if (phase === 'create' && existing.base_id === null && !isPendingId(baseId)) {
      tablesAdopted += 1
      return updateTable(orgId, existing.id, { baseId })
    }
    return existing
  }
  if (phase === 'validate') {
    const id = `pending:${input.slug}`
    tableNames.set(id, input.name)
    return { ...input, id } as EngineTable
  }
  tablesCreated += 1
  const created = await createTable(
    orgId,
    { ...input, baseId: isPendingId(baseId) ? undefined : baseId },
    SEED_ACTOR,
  )
  tableNames.set(created.id, created.name)
  return created
}

/** Create a field unless one with the same name already exists on the table. An existing
 * same-name field must match the expected TYPE — a mismatch is recorded as a conflict
 * (validate pass) that aborts the whole seed before anything is created. */
async function ensureField(
  orgId: string,
  tableId: string,
  input: CreateFieldInput,
): Promise<{ field: EngineField; created: boolean }> {
  if (isPendingId(tableId)) return { field: stubField(input), created: false }
  const fields = await listFields(orgId, tableId)
  const existing = fields.find((f) => f.name === input.name)
  if (existing) {
    if (phase === 'validate' && existing.type !== input.type) {
      conflicts.push(
        `Seed conflict: field '${input.name}' on table '${tableNames.get(tableId)}' exists ` +
          `with type ${existing.type}, expected ${input.type} — resolve manually`,
      )
    }
    return { field: existing, created: false }
  }
  if (phase === 'validate') return { field: stubField(input), created: false }
  fieldsCreated += 1
  return { field: await createField(orgId, tableId, input, SEED_ACTOR), created: true }
}

/**
 * Create a linked_record field on `tableId` pointing at `targetTableId`. The engine
 * auto-creates the inverse on the target named after the source table ("Leads"); when the
 * spec wants a singular inverse name ("Lead"), rename it right after creation.
 * An existing same-name field must be a linked_record AND point at the intended target
 * table — anything else is a conflict that aborts the seed.
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
  if (
    phase === 'validate' &&
    !created &&
    !isPendingId(field.id) &&
    field.type === 'linked_record' && // wrong type already recorded by ensureField
    field.options.linkedTableId !== targetTableId
  ) {
    conflicts.push(
      `Seed conflict: field '${name}' on table '${tableNames.get(tableId)}' is a ` +
        `linked_record pointing at table ${field.options.linkedTableId}, expected ` +
        `${targetTableId} ('${tableNames.get(targetTableId)}') — resolve manually`,
    )
  }
  if (created) {
    inverseFieldsCreated += 1
    if (inverseName && field.options.inverseFieldId) {
      await updateField(orgId, targetTableId, field.options.inverseFieldId, { name: inverseName })
    }
  }
  return field
}

/** Create a view unless one with the same name exists — which must match the expected
 * TYPE, else the seed aborts (same rule as fields). */
async function ensureView(
  orgId: string,
  tableId: string,
  name: string,
  type: ViewType,
  config?: ViewConfig,
): Promise<void> {
  if (isPendingId(tableId)) return
  const views = await listViews(orgId, tableId)
  const existing = views.find((v) => v.name === name)
  if (existing) {
    if (phase === 'validate' && existing.type !== type) {
      conflicts.push(
        `Seed conflict: view '${name}' on table '${tableNames.get(tableId)}' exists with ` +
          `type ${existing.type}, expected ${type} — resolve manually`,
      )
    }
    return
  }
  if (phase === 'validate') return
  viewsCreated += 1
  await createView(orgId, tableId, { name, type, config })
}

/**
 * Self-heal an EXISTING view's filters with one extra condition (matched by fieldId+op,
 * so reruns never duplicate it). Deployments seeded before the relative-date ops existed
 * gain the condition here; fresh seeds already carry it in ensureView's config, and a
 * view that doesn't exist yet is left to ensureView. Create phase only — the validate
 * pass makes zero writes.
 */
async function ensureViewFilterCondition(
  orgId: string,
  tableId: string,
  viewName: string,
  condition: FilterCondition,
): Promise<void> {
  if (phase !== 'create' || isPendingId(tableId) || isPendingId(condition.fieldId)) return
  const views = await listViews(orgId, tableId)
  const existing = views.find((v) => v.name === viewName)
  if (!existing || existing.type !== 'grid') return
  const filters = existing.config.filters ?? []
  if (filters.some((f) => f.fieldId === condition.fieldId && f.op === condition.op)) return
  await updateView(orgId, tableId, existing.id, {
    config: { ...existing.config, filters: [...filters, condition] },
  })
  console.log(
    `note: view '${viewName}' gained the ${condition.op} condition on rerun (self-heal).`,
  )
}

/** Shorthand for select options: [id, name, color] triples -> {choices}. */
function sel(...cs: Array<[string, string, string]>): FieldOptions {
  return { choices: cs.map(([id, name, color]) => ({ id, name, color })) }
}

/** The full seed walk. Runs twice: phase='validate' (checks only, zero writes), then —
 * only if no conflicts — phase='create' (writes whatever is missing). */
async function seed(orgId: string) {
  // --- Base: every Sales CRM table lives in (or is adopted into) "Sales CRM" -----------
  const baseId = await ensureBase(orgId, { name: 'Sales CRM', slug: 'sales-crm', icon: '🎯' })

  // --- Tables (Leads first so it takes the first tab) --------------------------------
  const leads = await ensureTable(orgId, baseId, {
    name: 'Leads',
    slug: 'leads',
    icon: '🎯',
    description: 'Sales pipeline — one row per company from intake to close (docs/09).',
  })
  // Contacts is SHARED with the Client Hub (docs/10) but BELONGS to Sales CRM — this seed
  // owns its base membership (seed-clienthub never grabs it).
  const contacts = await ensureTable(orgId, baseId, {
    name: 'Contacts',
    slug: 'contacts',
    icon: '👤',
    description: 'People at lead companies. Separate table so contacts survive lead→client conversion.',
  })
  const activities = await ensureTable(orgId, baseId, {
    name: 'Activities',
    slug: 'activities',
    icon: '📞',
    description: 'Calls, emails, meetings, and notes — the timeline on each lead.',
  })
  const audits = await ensureTable(orgId, baseId, {
    name: 'Audit Handoffs',
    slug: 'audit-handoffs',
    icon: '🔍',
    description: 'What the audit team needs when a lead reaches the Audit stage.',
  })
  const agreements = await ensureTable(orgId, baseId, {
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
  // Follow-ups: stage-not-terminal ∧ Next Action Due on or before today (docs/09's
  // "due <= today" half — a relative-date op evaluated at read time, never frozen).
  const dueCondition: FilterCondition = { fieldId: nextDueF.id, op: 'on_or_before_today' }
  await ensureView(orgId, leads.id, 'Follow-ups', 'grid', {
    filters: [
      ...terminalStages.map((id) => ({ fieldId: stageF.id, op: 'neq' as const, value: id })),
      dueCondition,
    ],
    sorts: [{ fieldId: nextDueF.id, direction: 'asc' }],
  })
  // Pre-relative-date deployments: append the due condition to the EXISTING view once.
  await ensureViewFilterCondition(orgId, leads.id, 'Follow-ups', dueCondition)
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
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.')
  const orgId = await ensureOrgId()

  // Pass 1: validate every existing same-name field/view against the expected shape
  // BEFORE creating anything, so a conflict aborts with zero writes (no partial seed).
  phase = 'validate'
  await seed(orgId)
  if (conflicts.length > 0) {
    throw new Error(`Seed aborted — nothing was created:\n${conflicts.join('\n')}`)
  }

  // Pass 2: same walk, now creating whatever is missing.
  phase = 'create'
  await seed(orgId)

  console.log(
    `Sales CRM seed complete: ${basesCreated} bases, ${tablesCreated} tables ` +
      `(+ ${tablesAdopted} adopted into the base), ${fieldsCreated} fields ` +
      `(+ ${inverseFieldsCreated} auto-inverse links), ${viewsCreated} views created.`,
  )
  if (basesCreated + tablesCreated + tablesAdopted + fieldsCreated + viewsCreated === 0) {
    console.log('Everything already present — nothing to do (idempotent re-run).')
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
