// Client Hub seed (docs/10-client-hub.md) — the second product configured ON the engine,
// extending the Sales CRM (docs/09). Creates eight tables (Clients, Team Members,
// Assignments, Engagements, Client Docs, Prompt Doc Cycles, Discount Codes, Tech Stack)
// and EXTENDS the existing shared Contacts table from seed:salescrm with the doc-10
// fields (one contacts table serves lead → client conversion natively). Taxonomies are
// pulled verbatim from Jacob's reference Airtable Clients base (app6dURlx07ZIMawS);
// Services keeps the same choice ids as seed-salescrm's "Interested Services" where the
// two overlap. ZERO records — Roam starts empty.
//
// Run: DATABASE_URL=postgres://... pnpm --filter @retentionos/db seed:clienthub
// (Run seed:salescrm first so Contacts exists; if it doesn't, this seed creates Contacts
// with the union of the doc-09 + doc-10 field sets and says so.)
//
// Idempotency: same contract as seed-salescrm — tables matched by slug, fields/views by
// name; a same-name field/view must match the expected type (and link target), else the
// seed ABORTS before creating anything. All checks run in a validate pass before any
// writes (two-phase: validate, then create), so a conflict never leaves a half-seeded
// table behind. Built entirely through @retentionos/engine.
//
// Engine-gap status (docs/10 "engine work" + verification notes):
//  - CLOSED: depth-2 lookup chaining. "Active PM"/"Active Strategist" want the ASSIGNEE'S
//    NAME, which lives two hops away (Clients → Assignments → Team Members). The seed
//    builds the natural construction: Assignments carries a helper lookup 'Team Member
//    Name' (→ Team Members.Name) and Clients aggregate THROUGH it with filtered concat
//    rollups (End is_empty ∧ Role eq). Deployments seeded before chaining landed
//    self-heal on rerun — the helper lookup + name rollups are added alongside the old
//    fallback COUNT rollups ("Active Team Count" etc.), which stay (user-visible fields
//    are never deleted).
//  - Still open: "Prompt Doc Cycles · Current Month" needs a THIS-MONTH filter; the
//    relative-date ops (on_or_before_today / on_or_after_today) don't express a month
//    slice, and a literal Month/Year filter would freeze at seed time — seeded as a
//    plain grid; the month slice lives in n8n's API query.

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
  updateTable,
} from '@retentionos/engine'
import type {
  Actor,
  CreateFieldInput,
  EngineError,
  EngineField,
  EngineTable,
  FieldOptions,
  LinkFilterCondition,
  ViewConfig,
  ViewType,
} from '@retentionos/engine'

const SEED_ACTOR: Actor = { type: 'user', id: 'seed' }

let basesCreated = 0
let tablesCreated = 0
let tablesAdopted = 0
let fieldsCreated = 0
let inverseFieldsCreated = 0
let viewsCreated = 0
const notes: string[] = []

// Two-phase execution, same as seed-salescrm: the whole seed body runs twice. The
// 'validate' pass creates NOTHING — it checks every existing same-name field/view against
// the expected type/link-target and collects conflicts. Only if the validate pass is clean
// does the 'create' pass run and write whatever is missing. Not-yet-existing tables get a
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

/** Ensure the seed's base exists (matched by slug), same contract as seed-salescrm:
 * existing base wins, validate pass creates nothing ("pending:" sentinel). */
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

/** Ensure a table exists (matched by slug), optionally inside a base. With a baseId, a
 * pre-existing table whose base_id is NULL is ADOPTED into the base (the backfill path
 * for deployments seeded before bases existed); a table already in ANY base is left
 * alone. baseId null = leave/create the table ungrouped (the shared-Contacts path —
 * seed-salescrm owns that table's base membership). Adoption happens only in the create
 * pass (the validate pass makes zero writes) and only fills NULL, so it can't conflict. */
async function ensureTable(
  orgId: string,
  baseId: string | null,
  input: { name: string; slug: string; icon: string; description: string },
): Promise<EngineTable> {
  const existing = await getTableBySlug(orgId, input.slug)
  if (existing) {
    tableNames.set(existing.id, existing.name)
    if (phase === 'create' && baseId && existing.base_id === null && !isPendingId(baseId)) {
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
    { ...input, baseId: baseId && !isPendingId(baseId) ? baseId : undefined },
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
 * auto-creates the inverse on the target named after the source table — every link in
 * doc 10 is arranged so the auto name IS the spec name (child tables are named for their
 * inverse: "Assignments" on Clients comes from the Assignments table's "Client" link).
 * An existing same-name field must be a linked_record AND point at the intended target
 * table — anything else is a conflict that aborts the seed.
 */
async function ensureLink(
  orgId: string,
  tableId: string,
  name: string,
  targetTableId: string,
): Promise<EngineField> {
  // Creating a linked_record auto-creates an inverse on the TARGET table named after the
  // source table. In the validate pass, when this link is about to be created (it doesn't
  // exist yet) and the target table already exists, that auto-name must be free on the
  // target — or already be the expected linked_record back at the source. Anything else
  // (say, a text field squatting on the name) is a conflict that aborts before any create,
  // never mid-create.
  if (phase === 'validate' && !isPendingId(targetTableId)) {
    const linkExists = isPendingId(tableId)
      ? false
      : (await listFields(orgId, tableId)).some((f) => f.name === name)
    if (!linkExists) {
      const inverseName = tableNames.get(tableId) ?? ''
      const clash = (await listFields(orgId, targetTableId)).find((f) => f.name === inverseName)
      if (clash && !(clash.type === 'linked_record' && clash.options.linkedTableId === tableId)) {
        conflicts.push(
          `Seed conflict: creating the '${name}' link on '${inverseName}' would auto-create ` +
            `an inverse field '${inverseName}' on '${tableNames.get(targetTableId)}', but a ` +
            `${clash.type} field with that name already exists there — resolve manually`,
        )
      }
    }
  }
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
  if (created) inverseFieldsCreated += 1
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

/** Shorthand for select options: [id, name, color] triples -> {choices}. */
function sel(...cs: Array<[string, string, string]>): FieldOptions {
  return { choices: cs.map(([id, name, color]) => ({ id, name, color })) }
}

// --- Reference taxonomies (verbatim from the Airtable Clients base) ---------------------

// Team-member roles — shared by Team Members.Role (multi_select) and Assignments.Role
// (single_select). Same ids so the filtered rollups on Clients filter on stable values.
const ROLE_CHOICES: Array<[string, string, string]> = [
  ['strategist', 'Strategist', 'blue'],
  ['copywriter', 'Copywriter', 'cyan'],
  ['designer', 'Designer', 'teal'],
  ['project_manager', 'Project Manager', 'green'],
  ['implementer', 'Implementer', 'yellow'],
  ['slicer', 'Slicer', 'orange'],
  ['campaign_coordinator', 'Campaign Coordinator', 'red'],
  ['team_lead', 'Team Lead', 'pink'],
  ['leadership', 'Leadership', 'purple'],
  ['account_manager', 'Account Manager', 'gray'],
  ['creative_strategist', 'Creative Strategist', 'blue'],
  ['graphic_designer', 'Graphic Designer', 'cyan'],
  ['video_editor', 'Video Editor', 'teal'],
  ['builder', 'Builder', 'green'],
  ['other', 'Other', 'yellow'],
]

const DEPARTMENT_CHOICES: Array<[string, string, string]> = [
  ['email', 'Email', 'blue'],
  ['paid', 'Paid', 'cyan'],
  ['leadership', 'Leadership', 'teal'],
  ['operations', 'Operations', 'green'],
]

// Service lines — ids match seed-salescrm's "Interested Services" where they overlap
// (paid_social / email_sms / landing_pages / direct_mail); UGC comes from the reference
// Clients base's Services taxonomy.
const SERVICE_CHOICES: Array<[string, string, string]> = [
  ['paid_social', 'Paid Social', 'blue'],
  ['landing_pages', 'Landing Pages', 'cyan'],
  ['ugc', 'UGC', 'teal'],
  ['email_sms', 'Email/SMS', 'green'],
  ['direct_mail', 'Direct Mail', 'yellow'],
]

const MONTH_CHOICES: Array<[string, string, string]> = [
  ['jan', 'January', 'blue'],
  ['feb', 'February', 'cyan'],
  ['mar', 'March', 'teal'],
  ['apr', 'April', 'green'],
  ['may', 'May', 'yellow'],
  ['jun', 'June', 'orange'],
  ['jul', 'July', 'red'],
  ['aug', 'August', 'pink'],
  ['sep', 'September', 'purple'],
  ['oct', 'October', 'gray'],
  ['nov', 'November', 'blue'],
  ['dec', 'December', 'cyan'],
]

/**
 * "Active PM" / "Active Strategist" the way doc 10 WANTS them: the assignee's NAME,
 * filtered over Assignments (End empty ∧ Role=<role>). The name lives on Team Members —
 * one hop past the Assignments link — so this is a depth-2 chain: Assignments carries
 * the helper lookup 'Team Member Name' (→ Team Members.Name) and Clients aggregate
 * THROUGH it with a filtered concat rollup targeting that lookup. Deployments seeded
 * before chaining landed self-heal here on rerun (the old fallback COUNT rollups stay —
 * user-visible fields are never deleted).
 * Returns true if the rollup exists (pre-existing or created), false on engine rejection.
 */
async function attemptActivePersonRollup(
  orgId: string,
  clientsTableId: string,
  name: string,
  assignmentsLinkFieldId: string,
  teamMemberNameLookupId: string,
  filters: LinkFilterCondition[],
): Promise<boolean> {
  if (isPendingId(clientsTableId)) return false
  const fields = await listFields(orgId, clientsTableId)
  const existing = fields.find((f) => f.name === name)
  if (existing) {
    // Someone already materialized it — require the expected type.
    if (phase === 'validate' && existing.type !== 'rollup') {
      conflicts.push(
        `Seed conflict: field '${name}' on table 'Clients' exists with type ` +
          `${existing.type}, expected rollup — resolve manually`,
      )
    }
    return true
  }
  if (phase === 'validate') return false // nothing to check; creation is attempted later
  try {
    await createField(
      orgId,
      clientsTableId,
      {
        name,
        type: 'rollup',
        options: {
          recordLinkFieldId: assignmentsLinkFieldId,
          targetFieldId: teamMemberNameLookupId, // the depth-2 hop: a lookup on Assignments
          aggregate: 'concat',
          filters,
        },
      },
      SEED_ACTOR,
    )
    fieldsCreated += 1
    notes.push(
      `'${name}' seeded as a filtered concat rollup through Assignments' 'Team Member ` +
        `Name' lookup (depth-2 chaining).`,
    )
    return true
  } catch (err) {
    const message = (err as EngineError).message ?? String(err)
    notes.push(
      `'${name}' could not be built — the engine rejected the depth-2 construction ` +
        `(engine said: "${message}"). Seeded filtered COUNT rollups instead.`,
    )
    return false
  }
}

/** The full seed walk. Runs twice: phase='validate' (checks only, zero writes), then —
 * only if no conflicts — phase='create' (writes whatever is missing). */
async function seed(orgId: string) {
  // --- Base: every Client Hub table lives in (or is adopted into) "Client Hub".
  // EXCEPTION: the shared Contacts table belongs to Sales CRM (seed-salescrm owns it).
  const baseId = await ensureBase(orgId, { name: 'Client Hub', slug: 'client-hub', icon: '🤝' })

  // --- Tables (Clients first so it takes the first client-hub tab) ---------------------
  const clients = await ensureTable(orgId, baseId, {
    name: 'Clients',
    slug: 'clients',
    icon: '🏢',
    description: 'The client hub — every piece of information we have about a brand (docs/10).',
  })
  const teamMembers = await ensureTable(orgId, baseId, {
    name: 'Team Members',
    slug: 'team-members',
    icon: '👥',
    description: 'Roam team roster — assignment targets, Slack/Asana identities.',
  })
  const assignments = await ensureTable(orgId, baseId, {
    name: 'Assignments',
    slug: 'assignments',
    icon: '📌',
    description: 'Temporal junction: who serves which client in which role, from Start to End.',
  })
  const engagements = await ensureTable(orgId, baseId, {
    name: 'Engagements',
    slug: 'engagements',
    icon: '📝',
    description: 'The contract/service record (née Scopes) — economics arrive via Agreement conversion.',
  })
  const clientDocs = await ensureTable(orgId, baseId, {
    name: 'Client Docs',
    slug: 'client-docs',
    icon: '📁',
    description: 'Doc links by client, type, and year — replaces per-year URL columns.',
  })
  const promptDocCycles = await ensureTable(orgId, baseId, {
    name: 'Prompt Doc Cycles',
    slug: 'prompt-doc-cycles',
    icon: '🔄',
    description: 'Monthly questionnaire tracker, written by n8n through /api/v1.',
  })
  const discountCodes = await ensureTable(orgId, baseId, {
    name: 'Discount Codes',
    slug: 'discount-codes',
    icon: '🏷️',
    description: 'Client discount codes for email/paid team use.',
  })
  const techStack = await ensureTable(orgId, baseId, {
    name: 'Tech Stack',
    slug: 'tech-stack',
    icon: '🧰',
    description: 'Software catalog linked from Clients. Delete if still unlinked after a quarter (docs/10).',
  })

  // Contacts is SHARED with the Sales CRM (docs/09) — extend it, never create a twin.
  // If seed:salescrm hasn't run, create it here with the union of both docs' field sets.
  // Base membership: Contacts BELONGS to Sales CRM (baseId null here — never adopted into
  // Client Hub); when created by this seed it stays ungrouped until seed:salescrm adopts it.
  let contacts = await getTableBySlug(orgId, 'contacts')
  const contactsPreexisting = contacts !== null
  if (contacts) {
    tableNames.set(contacts.id, contacts.name)
  } else {
    contacts = await ensureTable(orgId, null, {
      name: 'Contacts',
      slug: 'contacts',
      icon: '👤',
      description: 'People at lead companies. Separate table so contacts survive lead→client conversion.',
    })
    if (phase === 'create') {
      notes.push(
        'Contacts did not exist (seed:salescrm not run) — created it with the union of the ' +
          'doc-09 + doc-10 field sets. The Leads link arrives when seed:salescrm runs.',
      )
    }
  }
  // The doc-09 half of the union (sans the Leads link, which the salescrm seed owns).
  // Runs even when Contacts preexists: ensureField is idempotent, so a crashed or partial
  // earlier run self-heals here instead of staying half-fielded forever.
  await ensureField(orgId, contacts.id, { name: 'First Name', type: 'text' })
  await ensureField(orgId, contacts.id, { name: 'Last Name', type: 'text' })
  await ensureField(orgId, contacts.id, { name: 'Email', type: 'email' })
  await ensureField(orgId, contacts.id, { name: 'Job Title', type: 'text' })
  await ensureField(orgId, contacts.id, { name: 'Notes', type: 'long_text' })

  // --- Clients: identity + comms/automation groups (docs/10 field order) ----------------
  await ensureField(orgId, clients.id, { name: 'Client', type: 'text' }) // primary
  await ensureField(orgId, clients.id, { name: 'Domain', type: 'url' })
  await ensureField(orgId, clients.id, { name: 'Logo', type: 'attachment' })
  await ensureField(orgId, clients.id, {
    name: 'Industry',
    type: 'single_select',
    options: sel(
      ['apparel', 'Apparel', 'blue'],
      ['footwear', 'Footwear', 'cyan'],
      ['accessories', 'Accessories', 'teal'],
      ['beauty_personal_care', 'Beauty and Personal Care', 'green'],
      ['home_lifestyle', 'Home and Lifestyle', 'yellow'],
      ['food_beverage', 'Food and Beverage', 'orange'],
      ['pets', 'Pets', 'red'],
      ['health_fitness', 'Health and Fitness', 'pink'],
      ['hobbies_leisure', 'Hobbies and Leisure', 'purple'],
      ['baby_kids', 'Baby and Kids', 'blue'],
      ['electronics_tech', 'Electronics & Tech', 'cyan'],
      ['luxury_premium', 'Luxury / Premium Goods', 'teal'],
      ['other', 'Other', 'gray'],
    ),
  })
  await ensureField(orgId, clients.id, {
    name: 'Services',
    type: 'multi_select',
    options: sel(...SERVICE_CHOICES),
  })
  const { field: clientStatusF } = await ensureField(orgId, clients.id, {
    name: 'Status',
    type: 'single_select',
    options: sel(
      ['onboarding', 'Onboarding', 'teal'],
      ['active', 'Active', 'green'],
      ['paused', 'Paused', 'yellow'],
      ['churned', 'Churned', 'red'],
    ),
  })
  await ensureField(orgId, clients.id, { name: 'Internal Slack Channel ID', type: 'text' })
  await ensureField(orgId, clients.id, { name: 'External Slack Channel ID', type: 'text' })
  await ensureField(orgId, clients.id, {
    name: 'Approval Channel',
    type: 'single_select',
    options: sel(['slack', 'Slack', 'blue'], ['email', 'Email', 'green']),
  })
  await ensureField(orgId, clients.id, {
    name: 'Approval Link Mode',
    type: 'single_select',
    options: sel(['figma_only', 'Figma Only', 'blue'], ['asana_only', 'Asana Only', 'cyan'], ['both', 'Both', 'teal']),
  })
  await ensureField(orgId, clients.id, { name: 'Asana Tracker GID', type: 'text' })
  await ensureField(orgId, clients.id, { name: 'Answer Prompts', type: 'checkbox' })

  // --- Contacts: the doc-10 extension (the Client link puts 'Contacts' on Clients) ------
  await ensureLink(orgId, contacts.id, 'Client', clients.id)
  await ensureField(orgId, contacts.id, { name: 'Slack ID', type: 'text' })
  await ensureField(orgId, contacts.id, { name: 'Approver', type: 'checkbox' })
  await ensureField(orgId, contacts.id, {
    name: 'Comms Owner',
    type: 'single_select',
    options: sel(['jacob', 'Jacob', 'blue'], ['riley', 'Riley', 'cyan']),
  })
  await ensureField(orgId, contacts.id, { name: 'Role', type: 'text' })
  await ensureField(orgId, contacts.id, {
    name: 'Status',
    type: 'single_select',
    options: sel(['active', 'Active', 'green'], ['churned', 'Churned', 'red']),
  })

  // --- Team Members ----------------------------------------------------------------------
  const { field: tmNameF } = await ensureField(orgId, teamMembers.id, { name: 'Name', type: 'text' })
  await ensureField(orgId, teamMembers.id, {
    name: 'Role',
    type: 'multi_select',
    options: sel(...ROLE_CHOICES),
  })
  await ensureField(orgId, teamMembers.id, {
    name: 'Department',
    type: 'single_select',
    options: sel(...DEPARTMENT_CHOICES),
  })
  await ensureField(orgId, teamMembers.id, {
    name: 'Status',
    type: 'single_select',
    options: sel(['active', 'Active', 'green'], ['inactive', 'Inactive', 'red']),
  })
  await ensureField(orgId, teamMembers.id, { name: 'Work Email', type: 'email' })
  await ensureField(orgId, teamMembers.id, { name: 'Slack User ID', type: 'text' })
  await ensureField(orgId, teamMembers.id, { name: 'Asana GID', type: 'text' })

  // --- Assignments (temporal junction; Role/Department are the assignment's own, not
  // lookups — the reference's lookup chain is what made "Active PM" a 4-formula hack) ----
  const assignClientLink = await ensureLink(orgId, assignments.id, 'Client', clients.id)
  // The derived rollups on Clients hang off this link's auto-inverse ('Assignments' on
  // Clients). When the link preexists, its options.inverseFieldId must resolve to a real
  // linked_record field on Clients pointing back at Assignments — verified HERE, in the
  // validate pass, so a broken inverse aborts with zero writes instead of mid-create.
  // (A pending id means this run creates the link, and the engine wires the inverse.)
  if (phase === 'validate' && !isPendingId(assignClientLink.id)) {
    const inverseId = assignClientLink.options.inverseFieldId
    const clientsFields = isPendingId(clients.id) ? [] : await listFields(orgId, clients.id)
    const inverse = inverseId ? clientsFields.find((f) => f.id === inverseId) : undefined
    if (
      !inverse ||
      inverse.type !== 'linked_record' ||
      inverse.options.linkedTableId !== assignments.id
    ) {
      conflicts.push(
        `Seed conflict: Assignments 'Client' link has no usable inverse on Clients — resolve manually`,
      )
    }
  }
  const asgTeamMemberLink = await ensureLink(orgId, assignments.id, 'Team Member', teamMembers.id)
  const { field: assignRoleF } = await ensureField(orgId, assignments.id, {
    name: 'Role',
    type: 'single_select',
    options: sel(...ROLE_CHOICES),
  })
  await ensureField(orgId, assignments.id, {
    name: 'Department',
    type: 'single_select',
    options: sel(...DEPARTMENT_CHOICES),
  })
  await ensureField(orgId, assignments.id, { name: 'Start', type: 'date' })
  const { field: assignEndF } = await ensureField(orgId, assignments.id, { name: 'End', type: 'date' })
  await ensureField(orgId, assignments.id, {
    name: 'Reason',
    type: 'single_select',
    options: sel(
      ['transitioned', 'Transitioned', 'blue'],
      ['churn', 'Churn', 'red'],
      ['employee_left', 'Employee Left', 'orange'],
      ['other', 'Other', 'gray'],
    ),
  })
  // The depth-2 helper: the assignee's name pulled onto the assignment itself, so Clients'
  // "Active PM"/"Active Strategist" rollups can chain THROUGH it (Clients → Assignments →
  // Team Members.Name). Added on rerun to pre-chaining deployments (self-heal).
  const { field: tmNameLookupF } = await ensureField(orgId, assignments.id, {
    name: 'Team Member Name',
    type: 'lookup',
    options: { recordLinkFieldId: asgTeamMemberLink.id, targetFieldId: tmNameF.id },
  })

  // --- Engagements -------------------------------------------------------------------------
  const engageClientLink = await ensureLink(orgId, engagements.id, 'Client', clients.id)
  await ensureField(orgId, engagements.id, {
    name: 'Service',
    type: 'single_select',
    options: sel(...SERVICE_CHOICES),
  })
  // Type taxonomy verbatim from the reference base's "Scope Type".
  await ensureField(orgId, engagements.id, {
    name: 'Type',
    type: 'single_select',
    options: sel(
      ['full_service_retention', 'Full Service (Retention)', 'blue'],
      ['strategy_execution_retention', 'Strategy & Execution (Retention)', 'cyan'],
      ['meta_paid_social', 'Meta (Paid Social)', 'teal'],
      ['tiktok_paid_social', 'TikTok (Paid Social)', 'green'],
      ['lps_paid_social', "LP's (Paid Social)", 'yellow'],
      ['paid_social_consulting', 'Paid Social Consulting', 'orange'],
      ['retention_consulting', 'Retention Consulting', 'pink'],
      ['custom', 'Custom', 'gray'],
    ),
  })
  const { field: engageStartF } = await ensureField(orgId, engagements.id, { name: 'Start', type: 'date' })
  const { field: engageEndF } = await ensureField(orgId, engagements.id, { name: 'End', type: 'date' })
  await ensureField(orgId, engagements.id, {
    name: 'Monthly Fee',
    type: 'currency',
    options: { currencySymbol: '$' },
  })
  // Deliverable counts were free text in the reference base; they are numbers here.
  await ensureField(orgId, engagements.id, { name: 'Emails per month', type: 'number', options: { precision: 0 } })
  await ensureField(orgId, engagements.id, { name: 'SMS per month', type: 'number', options: { precision: 0 } })
  await ensureField(orgId, engagements.id, { name: 'Direct Mail per month', type: 'number', options: { precision: 0 } })
  await ensureField(orgId, engagements.id, { name: 'Notes', type: 'long_text' })

  // --- Client Docs (Doc Type taxonomy verbatim from docs/10) ------------------------------
  await ensureLink(orgId, clientDocs.id, 'Client', clients.id)
  await ensureField(orgId, clientDocs.id, {
    name: 'Doc Type',
    type: 'single_select',
    options: sel(
      ['prompt_doc', 'Prompt Doc', 'blue'],
      ['content_calendar', 'Content Calendar', 'cyan'],
      ['cr_copy_doc', 'CR Copy Doc', 'teal'],
      ['wip_copy_doc', 'WIP Copy Doc', 'green'],
      ['flow_copy_doc', 'Flow Copy Doc', 'yellow'],
      ['figma_wip', 'Figma WIP', 'orange'],
      ['figma_cr', 'Figma CR', 'red'],
      ['internal_folder', 'Internal Folder', 'pink'],
      ['external_folder', 'External Folder', 'purple'],
      ['brand_guidelines', 'Brand Guidelines', 'blue'],
      ['other', 'Other', 'gray'],
    ),
  })
  await ensureField(orgId, clientDocs.id, { name: 'Year', type: 'number', options: { precision: 0 } })
  await ensureField(orgId, clientDocs.id, { name: 'URL', type: 'url' })
  await ensureField(orgId, clientDocs.id, { name: 'Notes', type: 'text' })

  // --- Prompt Doc Cycles (written by n8n; enrollment = Clients where Answer Prompts) ------
  await ensureLink(orgId, promptDocCycles.id, 'Client', clients.id)
  await ensureField(orgId, promptDocCycles.id, { name: 'Year', type: 'number', options: { precision: 0 } })
  await ensureField(orgId, promptDocCycles.id, {
    name: 'Month',
    type: 'single_select',
    options: sel(...MONTH_CHOICES),
  })
  await ensureField(orgId, promptDocCycles.id, { name: 'Doc URL', type: 'url' })
  await ensureField(orgId, promptDocCycles.id, { name: 'Slack Thread TS', type: 'text' })
  await ensureField(orgId, promptDocCycles.id, { name: 'Sent At', type: 'datetime' })
  await ensureField(orgId, promptDocCycles.id, { name: 'Due', type: 'date' })
  await ensureField(orgId, promptDocCycles.id, {
    name: 'Status',
    type: 'single_select',
    options: sel(
      ['pending', 'Pending', 'gray'],
      ['sent', 'Sent', 'blue'],
      ['filled', 'Filled', 'green'],
      ['overdue', 'Overdue', 'red'],
      ['archived', 'Archived', 'yellow'],
    ),
  })
  await ensureField(orgId, promptDocCycles.id, { name: 'Word Count', type: 'number', options: { precision: 0 } })
  await ensureField(orgId, promptDocCycles.id, { name: 'Reminder Count', type: 'number', options: { precision: 0 } })
  await ensureField(orgId, promptDocCycles.id, {
    name: 'Filled Via',
    type: 'single_select',
    options: sel(['slack', 'Slack', 'blue'], ['dashboard', 'Dashboard', 'teal']),
  })

  // --- Discount Codes ----------------------------------------------------------------------
  await ensureLink(orgId, discountCodes.id, 'Client', clients.id)
  await ensureField(orgId, discountCodes.id, { name: 'Code', type: 'text' })
  await ensureField(orgId, discountCodes.id, { name: 'Discount', type: 'text' })
  await ensureField(orgId, discountCodes.id, {
    name: 'Team',
    type: 'single_select',
    options: sel(['email', 'Email', 'blue'], ['paid', 'Paid', 'cyan']),
  })
  await ensureField(orgId, discountCodes.id, {
    name: 'Status',
    type: 'single_select',
    options: sel(['active', 'Active', 'green'], ['message_sent', 'Message Sent', 'yellow']),
  })
  await ensureField(orgId, discountCodes.id, { name: 'Notes', type: 'text' })

  // --- Tech Stack (catalog; the link lives ON Clients, inverse 'Clients' lands here) -------
  await ensureField(orgId, techStack.id, { name: 'Software', type: 'text' })
  await ensureField(orgId, techStack.id, {
    name: 'Category',
    type: 'single_select',
    options: sel(
      ['marketing_automation', 'Marketing Automation', 'blue'],
      ['list_growth_lead_capture', 'List Growth & Lead Capture', 'purple'],
      ['ecommerce_platform', 'Ecommerce Platform', 'green'],
      ['reviews_referral_loyalty', 'Reviews, Referral, & Loyalty', 'teal'],
      ['subscription', 'Subscription', 'red'],
      ['customer_experience', 'Customer Experience', 'yellow'],
      ['analytics_data', 'Analytics & Data', 'orange'],
      ['project_management', 'Project Management', 'cyan'],
      ['communication', 'Communication', 'pink'],
      ['cro', 'CRO', 'gray'],
      ['other', 'Other', 'blue'],
    ),
  })
  await ensureLink(orgId, clients.id, 'Tech Stack', techStack.id)

  // --- Clients: derived fields (need the child links + filter field ids from above) -------
  // The Clients-side link fields are the auto-created inverses of the child 'Client' links.
  const clientsAssignmentsLinkId = assignClientLink.options.inverseFieldId ?? ''
  const clientsEngagementsLinkId = engageClientLink.options.inverseFieldId ?? ''

  const activeFilter: LinkFilterCondition[] = [{ fieldId: assignEndF.id, op: 'is_empty' }]
  const pmFilters: LinkFilterCondition[] = [
    { fieldId: assignEndF.id, op: 'is_empty' },
    { fieldId: assignRoleF.id, op: 'eq', value: 'project_manager' },
  ]
  const strategistFilters: LinkFilterCondition[] = [
    { fieldId: assignEndF.id, op: 'is_empty' },
    { fieldId: assignRoleF.id, op: 'eq', value: 'strategist' },
  ]

  const pmOk = await attemptActivePersonRollup(
    orgId, clients.id, 'Active PM', clientsAssignmentsLinkId, tmNameLookupF.id, pmFilters,
  )
  const strategistOk = await attemptActivePersonRollup(
    orgId, clients.id, 'Active Strategist', clientsAssignmentsLinkId, tmNameLookupF.id, strategistFilters,
  )
  // Pre-chaining fallback trio: still validated by name/type on every rerun (existing
  // deployments keep them — never deleted), and still the safety net if the depth-2
  // construction is ever rejected.
  if (!pmOk || !strategistOk || phase === 'validate') {
    await ensureField(orgId, clients.id, {
      name: 'Active Team Count',
      type: 'rollup',
      options: { recordLinkFieldId: clientsAssignmentsLinkId, aggregate: 'count', filters: activeFilter },
    })
    await ensureField(orgId, clients.id, {
      name: 'Active PM Count',
      type: 'rollup',
      options: { recordLinkFieldId: clientsAssignmentsLinkId, aggregate: 'count', filters: pmFilters },
    })
    await ensureField(orgId, clients.id, {
      name: 'Active Strategist Count',
      type: 'rollup',
      options: { recordLinkFieldId: clientsAssignmentsLinkId, aggregate: 'count', filters: strategistFilters },
    })
  }
  await ensureField(orgId, clients.id, {
    name: 'Client Since',
    type: 'rollup',
    options: { recordLinkFieldId: clientsEngagementsLinkId, aggregate: 'min', targetFieldId: engageStartF.id },
  })
  await ensureField(orgId, clients.id, {
    name: 'Open Engagements',
    type: 'rollup',
    options: {
      recordLinkFieldId: clientsEngagementsLinkId,
      aggregate: 'count',
      filters: [{ fieldId: engageEndF.id, op: 'is_empty' }],
    },
  })

  // --- Views ---------------------------------------------------------------------------------
  await ensureView(orgId, clients.id, 'All Clients', 'grid')
  await ensureView(orgId, clients.id, 'Active', 'grid', {
    filters: [{ fieldId: clientStatusF.id, op: 'eq', value: 'active' }],
  })
  await ensureView(orgId, clients.id, 'By Status', 'kanban', { groupByFieldId: clientStatusF.id })
  await ensureView(orgId, assignments.id, 'All Assignments', 'grid')
  await ensureView(orgId, assignments.id, 'Active', 'grid', {
    filters: [{ fieldId: assignEndF.id, op: 'is_empty' }],
  })
  await ensureView(orgId, engagements.id, 'All Engagements', 'grid')
  await ensureView(orgId, engagements.id, 'Open', 'grid', {
    filters: [{ fieldId: engageEndF.id, op: 'is_empty' }],
  })
  await ensureView(orgId, teamMembers.id, 'Grid', 'grid')
  await ensureView(orgId, clientDocs.id, 'Grid', 'grid')
  // "Current Month" needs relative-date (this-month) filters the grammar can't express —
  // a literal Month/Year value would freeze at seed time and go stale every month. Plain
  // grid; n8n slices the current month via the API instead (docs/N8N_INTEGRATION.md).
  await ensureView(orgId, promptDocCycles.id, 'Grid', 'grid')
  await ensureView(orgId, discountCodes.id, 'Grid', 'grid')
  await ensureView(orgId, techStack.id, 'Grid', 'grid')
  // Idempotent even when Contacts preexists (salescrm seeds the same 'Grid' view) — a
  // crashed earlier run that created the table but not the view self-heals on rerun.
  await ensureView(orgId, contacts.id, 'Grid', 'grid')
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
  notes.length = 0 // only report the create pass's notes
  await seed(orgId)

  console.log(
    `Client Hub seed complete: ${basesCreated} bases, ${tablesCreated} tables ` +
      `(+ ${tablesAdopted} adopted into the base), ${fieldsCreated} fields ` +
      `(+ ${inverseFieldsCreated} auto-inverse links), ${viewsCreated} views created.`,
  )
  for (const n of notes) console.log(`note: ${n}`)
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
