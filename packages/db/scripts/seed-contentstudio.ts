// Content Studio seed — the copy/marketing engine as engine configuration (docs/12,
// priority correction: "the copywriting and marketing part is the most important").
//
// Base "Content Studio" ✍️ with four tables:
//   Brand Voice  — per-client voice guide the agent writes WITH
//   Research     — ingested findings (surveys, review exports, audits) linked to clients
//   Skills       — reusable writing instructions (seeded with three starters)
//   Copy Drafts  — email/SMS drafts moving Draft → In Review → Approved → Sent
//
// Run: DATABASE_URL=postgres://... pnpm --filter @retentionos/db seed:contentstudio
//
// Idempotent at the table level: a table whose slug already exists is left untouched
// (rename-then-rerun creates a parallel table by design, same caveat as the CRM seeds).
// Client links are only created when the Client Hub's `clients` table exists; rerun
// after seed:clienthub to add them (the seed self-heals missing link fields).

import { getDefaultOrganization } from '../src/index'
import {
  createBase,
  createField,
  createRecord,
  createTable,
  createView,
  describeTable,
  getBaseBySlug,
  getTableBySlug,
  queryRecords,
} from '@retentionos/engine'
import type { Actor, EngineTable } from '@retentionos/engine'

const SEED_ACTOR: Actor = { type: 'user', id: 'seed' }

const created = { tables: 0, fields: 0, views: 0, records: 0 }
const notes: string[] = []

async function ensureOrgId(): Promise<string> {
  const org = await getDefaultOrganization()
  if (!org) throw new Error('No organization exists — run seed:engine first.')
  return org.id
}

async function ensureBaseId(orgId: string): Promise<string> {
  const existing = await getBaseBySlug(orgId, 'content-studio')
  if (existing) return existing.id
  const base = await createBase(orgId, { name: 'Content Studio', icon: '✍️' }, SEED_ACTOR)
  return base.id
}

/** Create a linked_record field only if the target table exists and a same-named field
 * doesn't already (self-heal path for reruns after seed:clienthub). */
async function ensureClientLink(orgId: string, table: EngineTable, name: string) {
  const clients = await getTableBySlug(orgId, 'clients')
  if (!clients) {
    notes.push(`${table.name}: skipped "${name}" link — no clients table yet (run seed:clienthub, then rerun this seed).`)
    return
  }
  const desc = await describeTable(orgId, table.id)
  if (desc.fields.some((f) => f.name === name)) return
  await createField(
    orgId,
    table.id,
    { name, type: 'linked_record', options: { linkedTableId: clients.id } },
    SEED_ACTOR,
  )
  created.fields += 1
}

type FieldSpec = { name: string; type: string; options?: Record<string, unknown> }

async function ensureTable(
  orgId: string,
  baseId: string,
  spec: { name: string; slug: string; icon: string; description: string },
  fields: FieldSpec[],
): Promise<{ table: EngineTable; fieldIds: Record<string, string>; fresh: boolean }> {
  const existing = await getTableBySlug(orgId, spec.slug)
  if (existing) {
    const desc = await describeTable(orgId, existing.id)
    const fieldIds = Object.fromEntries(desc.fields.map((f) => [f.name, f.id]))
    return { table: existing, fieldIds, fresh: false }
  }
  const table = await createTable(
    orgId,
    { name: spec.name, icon: spec.icon, description: spec.description, baseId },
    SEED_ACTOR,
  )
  created.tables += 1
  const fieldIds: Record<string, string> = {}
  for (const f of fields) {
    const field = await createField(
      orgId,
      table.id,
      { name: f.name, type: f.type as never, options: f.options as never },
      SEED_ACTOR,
    )
    fieldIds[f.name] = field.id
    created.fields += 1
  }
  await createView(orgId, table.id, { name: 'Grid', type: 'grid' })
  created.views += 1
  return { table, fieldIds, fresh: true }
}

const sel = (...names: string[]) => ({
  choices: names.map((n) => ({ id: n.toLowerCase().replace(/[^a-z0-9]+/g, '_'), name: n })),
})

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.')
  const orgId = await ensureOrgId()
  const baseId = await ensureBaseId(orgId)

  // --- Brand Voice -----------------------------------------------------------
  const voice = await ensureTable(
    orgId,
    baseId,
    {
      name: 'Brand Voice',
      slug: 'brand-voice',
      icon: '🗣️',
      description: 'Per-client voice guide. The agent reads this before writing anything.',
    },
    [
      { name: 'Brand', type: 'text' },
      { name: 'Tone', type: 'long_text' },
      { name: 'Vocabulary (words we use)', type: 'long_text' },
      { name: 'Banned phrases', type: 'long_text' },
      { name: 'Sample copy (sounds like us)', type: 'long_text' },
      { name: 'Reading level', type: 'single_select', options: sel('3rd-5th grade', '6th-8th grade', '9th+') },
      { name: 'Emoji usage', type: 'single_select', options: sel('None', 'Light', 'Heavy') },
      { name: 'Notes', type: 'long_text' },
    ],
  )
  await ensureClientLink(orgId, voice.table, 'Client')

  // --- Research ---------------------------------------------------------------
  const research = await ensureTable(
    orgId,
    baseId,
    {
      name: 'Research',
      slug: 'research',
      icon: '🔎',
      description: 'Ingested findings: surveys, review exports, audit notes, data pulls.',
    },
    [
      { name: 'Title', type: 'text' },
      {
        name: 'Type',
        type: 'single_select',
        options: sel('Survey', 'Review Export', 'Kickoff Notes', 'Audit Finding', 'Competitor', 'Data Pull', 'Other'),
      },
      { name: 'Summary', type: 'long_text' },
      { name: 'Raw notes', type: 'long_text' },
      { name: 'Source URL', type: 'url' },
      { name: 'Captured', type: 'date' },
    ],
  )
  await ensureClientLink(orgId, research.table, 'Client')

  // --- Skills -----------------------------------------------------------------
  const skills = await ensureTable(
    orgId,
    baseId,
    {
      name: 'Skills',
      slug: 'skills',
      icon: '🧰',
      description: 'Reusable writing instructions the agent applies on request.',
    },
    [
      { name: 'Skill', type: 'text' },
      { name: 'When to use', type: 'long_text' },
      { name: 'Instructions', type: 'long_text' },
      { name: 'Channel', type: 'multi_select', options: sel('Email', 'SMS', 'Any') },
      { name: 'Active', type: 'checkbox' },
    ],
  )

  // --- Copy Drafts --------------------------------------------------------------
  const drafts = await ensureTable(
    orgId,
    baseId,
    {
      name: 'Copy Drafts',
      slug: 'copy-drafts',
      icon: '📝',
      description: 'Email/SMS drafts: Draft → In Review → Approved → Sent.',
    },
    [
      { name: 'Title', type: 'text' },
      { name: 'Channel', type: 'single_select', options: sel('Email', 'SMS') },
      { name: 'Type', type: 'single_select', options: sel('Campaign', 'Flow', 'Pop-up', 'Other') },
      { name: 'Status', type: 'single_select', options: sel('Draft', 'In Review', 'Approved', 'Sent') },
      { name: 'Subject line', type: 'text' },
      { name: 'Preview text', type: 'text' },
      { name: 'Body', type: 'long_text' },
      { name: 'Due', type: 'date' },
      { name: 'Notes', type: 'long_text' },
    ],
  )
  await ensureClientLink(orgId, drafts.table, 'Client')
  if (drafts.fresh) {
    // Studio-internal links (voice/research/skills used) — created fresh-only; the
    // target tables were just ensured above so these can't dangle.
    for (const [name, target] of [
      ['Brand Voice', voice.table.id],
      ['Research used', research.table.id],
      ['Skills used', skills.table.id],
    ] as const) {
      await createField(
        orgId,
        drafts.table.id,
        { name, type: 'linked_record', options: { linkedTableId: target } },
        SEED_ACTOR,
      )
      created.fields += 1
    }
    const statusId = drafts.fieldIds['Status']!
    await createView(orgId, drafts.table.id, {
      name: 'Pipeline',
      type: 'kanban',
      config: { groupByFieldId: statusId },
    })
    await createView(orgId, drafts.table.id, {
      name: 'In Review',
      type: 'grid',
      config: { filters: [{ fieldId: statusId, op: 'eq', value: 'in_review' }] },
    })
    created.views += 2
  }

  // --- Starter skills (fresh table, or an existing one left empty by a previous
  // partial run — record-level self-heal) ----------------------------------------
  const skillsEmpty =
    skills.fresh || (await queryRecords(orgId, skills.table.id, { limit: 1 })).total === 0
  if (skillsEmpty) {
    const f = skills.fieldIds
    const starters = [
      {
        [f['Skill']!]: 'Welcome flow email',
        [f['When to use']!]: 'First email after signup via a pop-up or form. Goal: first purchase.',
        [f['Instructions']!]:
          'Lead with the single strongest brand promise, not a discount. One idea per email. ' +
          'Subject under 45 chars, curiosity or benefit, never clickbait. Body: 80-120 words, ' +
          '2nd person, one CTA button. If a welcome offer exists, hold it for the second ' +
          'paragraph. Close with social proof (one review line from Research if available). ' +
          'Always check Brand Voice: tone, banned phrases, emoji policy.',
        [f['Channel']!]: ['email'],
        [f['Active']!]: true,
      },
      {
        [f['Skill']!]: 'Winback SMS',
        [f['When to use']!]: 'Customer lapsed past their expected reorder window (check LTV/lifecycle data).',
        [f['Instructions']!]:
          'Max 160 chars including opt-out. Name the product they bought if known. One hook: ' +
          'either a concrete benefit of coming back or a time-boxed offer, never both. No ' +
          '"we miss you" cliches. Read Brand Voice for emoji policy — SMS defaults to none ' +
          'unless voice says Heavy.',
        [f['Channel']!]: ['sms'],
        [f['Active']!]: true,
      },
      {
        [f['Skill']!]: 'Subject line pass',
        [f['When to use']!]: 'Any email draft moving to In Review. Generate 5 subject options.',
        [f['Instructions']!]:
          'Five options: 1 benefit-led, 1 curiosity, 1 social-proof, 1 urgency (only if real), ' +
          '1 weird-but-on-voice. Under 45 chars each. Preview text must extend, not repeat, ' +
          'the subject. Flag any option that tripped a Banned phrase from Brand Voice.',
        [f['Channel']!]: ['email'],
        [f['Active']!]: true,
      },
    ]
    for (const values of starters) {
      await createRecord(orgId, skills.table.id, values, SEED_ACTOR)
      created.records += 1
    }
  }

  console.log(
    `Content Studio seed complete: ${created.tables} tables, ${created.fields} fields, ` +
      `${created.views} views, ${created.records} records created.`,
  )
  for (const n of notes) console.log(`note: ${n}`)
  if (created.tables + created.fields + created.views + created.records === 0) {
    console.log('Everything already present — nothing to do (idempotent re-run).')
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err?.message ?? err)
    process.exit(1)
  },
)
