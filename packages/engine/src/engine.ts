// @retentionos/engine — the ONE service layer under the meta-schema (agent-parity law).
// The web UI (via its REST API), n8n webhooks, and the future MCP server are all clients
// of these functions. There is no second, UI-only path. Every function is tenant-scoped by
// organizationId, and every record mutation writes an engine_record_revisions row so the
// audit trail (human-vs-agent-vs-api) is complete without the caller remembering to.

import { getPool, query, queryOne, slugify } from '@retentionos/db'
import { coerceValue, coerceValues, isFieldType, validateFieldOptions } from './fieldTypes'
import { parseFormula, referencedFieldIds } from './formula'
import { enrichRecords, syncLinksForField } from './links'
import { EngineError, isComputedType } from './types'
import type {
  Actor,
  EngineField,
  EngineRecord,
  EngineRecordRevision,
  EngineTable,
  EngineView,
  EnrichedRecord,
  FieldOptions,
  FieldType,
  FilterCondition,
  RevisionDiff,
  RevisionOp,
  SortSpec,
  TableDescriptor,
  ViewConfig,
  ViewType,
} from './types'

// ---------------------------------------------------------------------------
// Column lists (kept in one place so selects stay consistent).
// ---------------------------------------------------------------------------
const TABLE_COLS = `
  id, organization_id, name, slug, icon, description, position,
  created_by_type, created_by_id, created_at, updated_at`
const FIELD_COLS = `
  id, table_id, name, type, options, position, required,
  created_by_type, created_by_id, created_at, updated_at`
const RECORD_COLS = `
  id, table_id, organization_id, values, position,
  created_by_type, created_by_id, created_at, updated_at`
const VIEW_COLS = `
  id, table_id, name, type, config, position, created_at, updated_at`
const REVISION_COLS = `
  id, record_id, table_id, organization_id, actor_type, actor_id, op, diff, created_at`

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export interface CreateTableInput {
  name: string
  slug?: string
  icon?: string | null
  description?: string | null
}

/** Ensure the slug is unique within the org, suffixing -2, -3, … if needed. */
async function uniqueTableSlug(orgId: string, base: string): Promise<string> {
  const root = slugify(base) || 'table'
  let candidate = root
  let n = 1
  // Bounded loop: at worst a handful of collisions in practice.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const clash = await queryOne<{ id: string }>(
      'select id from public.engine_tables where organization_id = $1 and slug = $2',
      [orgId, candidate],
    )
    if (!clash) return candidate
    n += 1
    candidate = `${root}-${n}`
  }
}

export async function createTable(
  orgId: string,
  input: CreateTableInput,
  actor: Actor,
): Promise<EngineTable> {
  if (!input.name?.trim()) throw new EngineError('Table name is required.', 'bad_input')
  const slug = await uniqueTableSlug(orgId, input.slug ?? input.name)
  const pos = await nextPosition('engine_tables', 'organization_id', orgId)
  const row = await queryOne<EngineTable>(
    `insert into public.engine_tables
       (organization_id, name, slug, icon, description, position, created_by_type, created_by_id)
     values ($1,$2,$3,$4,$5,$6,$7::public.engine_actor_type,$8)
     returning ${TABLE_COLS}`,
    [orgId, input.name.trim(), slug, input.icon ?? null, input.description ?? null, pos, actor.type, actor.id ?? null],
  )
  if (!row) throw new EngineError('Failed to create table.')
  return row
}

export interface UpdateTablePatch {
  name?: string
  icon?: string | null
  description?: string | null
  position?: number
}

export async function updateTable(
  orgId: string,
  tableId: string,
  patch: UpdateTablePatch,
): Promise<EngineTable> {
  const sets: string[] = []
  const params: unknown[] = [orgId, tableId]
  if (patch.name !== undefined) {
    params.push(patch.name)
    sets.push(`name = $${params.length}`)
  }
  if (patch.icon !== undefined) {
    params.push(patch.icon)
    sets.push(`icon = $${params.length}`)
  }
  if (patch.description !== undefined) {
    params.push(patch.description)
    sets.push(`description = $${params.length}`)
  }
  if (patch.position !== undefined) {
    params.push(patch.position)
    sets.push(`position = $${params.length}`)
  }
  if (sets.length === 0) {
    const existing = await getTable(orgId, tableId)
    if (!existing) throw new EngineError('Table not found.', 'not_found')
    return existing
  }
  const row = await queryOne<EngineTable>(
    `update public.engine_tables set ${sets.join(', ')}
     where organization_id = $1 and id = $2
     returning ${TABLE_COLS}`,
    params,
  )
  if (!row) throw new EngineError('Table not found.', 'not_found')
  return row
}

export async function deleteTable(orgId: string, tableId: string): Promise<void> {
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('begin')
    // Other tables' linked_record fields that point AT this table have no surviving pair once
    // it's gone — delete those far-side fields in the same tx (their edges cascade via the
    // engine_record_links.field_id FK). This keeps remaining records readable (enrichRecords
    // no longer walks a dangling link field).
    await client.query(
      `delete from public.engine_fields
       where type = 'linked_record'
         and table_id <> $1::uuid
         and options ->> 'linkedTableId' = $1::text`,
      [tableId],
    )
    const res = await client.query(
      'delete from public.engine_tables where organization_id = $1 and id = $2 returning id',
      [orgId, tableId],
    )
    if ((res.rowCount ?? 0) === 0) {
      await client.query('rollback')
      throw new EngineError('Table not found.', 'not_found')
    }
    await client.query('commit')
  } catch (err) {
    if (!(err instanceof EngineError)) await client.query('rollback')
    throw err
  } finally {
    client.release()
  }
}

export async function listTables(orgId: string): Promise<EngineTable[]> {
  return query<EngineTable>(
    `select ${TABLE_COLS} from public.engine_tables
     where organization_id = $1 order by position asc, created_at asc`,
    [orgId],
  )
}

export async function getTable(orgId: string, tableId: string): Promise<EngineTable | null> {
  return queryOne<EngineTable>(
    `select ${TABLE_COLS} from public.engine_tables where organization_id = $1 and id = $2`,
    [orgId, tableId],
  )
}

export async function getTableBySlug(orgId: string, slug: string): Promise<EngineTable | null> {
  return queryOne<EngineTable>(
    `select ${TABLE_COLS} from public.engine_tables where organization_id = $1 and slug = $2`,
    [orgId, slug],
  )
}

/** Table + its fields + its views — the full schema descriptor for one table. */
export async function describeTable(orgId: string, tableId: string): Promise<TableDescriptor> {
  const table = await getTable(orgId, tableId)
  if (!table) throw new EngineError('Table not found.', 'not_found')
  const [fields, views] = await Promise.all([listFields(orgId, tableId), listViews(orgId, tableId)])
  return { table, fields, views }
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

export interface CreateFieldInput {
  name: string
  type: FieldType
  options?: FieldOptions
  required?: boolean
  position?: number
}

/** Confirm a table belongs to the org (used before field/record/view ops). */
async function assertTable(orgId: string, tableId: string): Promise<EngineTable> {
  const t = await getTable(orgId, tableId)
  if (!t) throw new EngineError('Table not found.', 'not_found')
  return t
}

/** Raw field insert inside a tx client (used for both a field and its auto-created inverse). */
async function insertField(
  client: { query: (t: string, p?: unknown[]) => Promise<{ rows: unknown[] }> },
  tableId: string,
  name: string,
  type: FieldType,
  options: FieldOptions,
  required: boolean,
  position: number,
  actor: Actor,
): Promise<EngineField> {
  const res = await client.query(
    `insert into public.engine_fields
       (table_id, name, type, options, position, required, created_by_type, created_by_id)
     values ($1,$2,$3,$4::jsonb,$5,$6,$7::public.engine_actor_type,$8)
     returning ${FIELD_COLS}`,
    [tableId, name, type, JSON.stringify(options), position, required, actor.type, actor.id ?? null],
  )
  return res.rows[0] as EngineField
}

/**
 * Enforce the Phase B field-creation restrictions that need a DB round-trip:
 *  - linked_record.linkedTableId must be a real table in this org.
 *  - lookup/rollup.recordLinkFieldId must be a linked_record field ON THIS table.
 *  - lookup/rollup.targetFieldId must be a CONCRETE (non-computed) field on the linked table
 *    (no lookup-of-lookup chains). Count rollups may omit targetFieldId.
 *  - lookup/rollup.filters[].fieldId must each be a CONCRETE (non-computed, non-linked)
 *    field on the linked table (their conditions evaluate against linked-row values).
 */
async function assertRelationOptions(
  orgId: string,
  tableId: string,
  type: FieldType,
  options: FieldOptions,
): Promise<void> {
  if (type === 'linked_record') {
    const t = await getTable(orgId, options.linkedTableId!)
    if (!t) throw new EngineError('linkedTableId does not reference a table in this org.', 'bad_options')
    return
  }
  if (type === 'lookup' || type === 'rollup') {
    const linkField = await queryOne<EngineField>(
      `select ${FIELD_COLS} from public.engine_fields where table_id = $1 and id = $2`,
      [tableId, options.recordLinkFieldId],
    )
    if (!linkField || linkField.type !== 'linked_record') {
      throw new EngineError('recordLinkFieldId must be a linked_record field on this table.', 'bad_options')
    }
    const targetTableId = linkField.options.linkedTableId
    if (options.targetFieldId) {
      const targetField = await queryOne<EngineField>(
        `select ${FIELD_COLS} from public.engine_fields where table_id = $1 and id = $2`,
        [targetTableId, options.targetFieldId],
      )
      if (!targetField) {
        throw new EngineError('targetFieldId is not a field on the linked table.', 'bad_options')
      }
      if (isComputedType(targetField.type)) {
        throw new EngineError('targetFieldId must be a concrete (non-computed) field — no lookup chains.', 'bad_options')
      }
    }
    if (options.filters && options.filters.length > 0) {
      const linkedFields = await query<EngineField>(
        `select ${FIELD_COLS} from public.engine_fields where table_id = $1`,
        [targetTableId],
      )
      const linkedById = new Map(linkedFields.map((f) => [f.id, f]))
      for (const c of options.filters) {
        const ff = linkedById.get(c.fieldId)
        if (!ff) {
          throw new EngineError(
            `Filter fieldId "${c.fieldId}" is not a field on the linked table.`,
            'bad_options',
          )
        }
        if (isComputedType(ff.type) || ff.type === 'linked_record') {
          throw new EngineError(
            `Filter field "${ff.name}" must be a concrete (non-computed, non-linked) field on the linked table.`,
            'bad_options',
          )
        }
      }
    }
  }
  if (type === 'formula') {
    // Every referenced field must exist ON THIS table and be number/currency/percent. No
    // chaining in v1: a formula may not reference another formula/rollup/lookup (or any
    // non-numeric field). The expression itself was already syntax-checked upstream.
    const ast = parseFormula(options.expression ?? '')
    const refIds = referencedFieldIds(ast)
    if (refIds.length === 0) return
    const tableFields = await query<EngineField>(
      `select ${FIELD_COLS} from public.engine_fields where table_id = $1`,
      [tableId],
    )
    const byId = new Map(tableFields.map((f) => [f.id, f]))
    const NUMERIC: FieldType[] = ['number', 'currency', 'percent']
    for (const id of refIds) {
      const ref = byId.get(id)
      if (!ref) {
        throw new EngineError(`Formula references field "${id}" that isn't on this table.`, 'bad_options')
      }
      if (!NUMERIC.includes(ref.type)) {
        throw new EngineError(
          `Formula can only reference number/currency/percent fields; "${ref.name}" is ${ref.type}.`,
          'bad_options',
        )
      }
    }
  }
}

export async function createField(
  orgId: string,
  tableId: string,
  input: CreateFieldInput,
  actor: Actor,
): Promise<EngineField> {
  const table = await assertTable(orgId, tableId)
  if (!input.name?.trim()) throw new EngineError('Field name is required.', 'bad_input')
  if (!isFieldType(input.type)) throw new EngineError(`Unknown field type "${input.type}".`, 'bad_type')
  const options = validateFieldOptions(input.type, input.options)
  await assertRelationOptions(orgId, tableId, input.type, options)
  const pos = input.position ?? (await nextPosition('engine_fields', 'table_id', tableId))

  // linked_record is special: creating one auto-creates the paired inverse field on the
  // target table, and the two point at each other via inverseFieldId — inside one tx.
  if (input.type === 'linked_record') {
    const targetTableId = options.linkedTableId!
    const targetPos = await nextPosition('engine_fields', 'table_id', targetTableId)
    const pool = getPool()
    const client = await pool.connect()
    try {
      await client.query('begin')
      const source = await insertField(
        client, tableId, input.name.trim(), 'linked_record',
        { linkedTableId: targetTableId }, input.required ?? false, pos, actor,
      )
      // Inverse field name mirrors Airtable ("<Source Table>" on the target).
      const inverse = await insertField(
        client, targetTableId, table.name, 'linked_record',
        { linkedTableId: tableId, inverseFieldId: source.id }, false, targetPos, actor,
      )
      // Back-fill the source field's inverseFieldId now that we know the inverse id.
      const updated = await client.query(
        `update public.engine_fields
           set options = jsonb_set(options, '{inverseFieldId}', to_jsonb($2::text))
         where id = $1 returning ${FIELD_COLS}`,
        [source.id, inverse.id],
      )
      await client.query('commit')
      return updated.rows[0] as EngineField
    } catch (err) {
      await client.query('rollback')
      throw err
    } finally {
      client.release()
    }
  }

  const row = await queryOne<EngineField>(
    `insert into public.engine_fields
       (table_id, name, type, options, position, required, created_by_type, created_by_id)
     values ($1,$2,$3,$4::jsonb,$5,$6,$7::public.engine_actor_type,$8)
     returning ${FIELD_COLS}`,
    [
      tableId,
      input.name.trim(),
      input.type,
      JSON.stringify(options),
      pos,
      input.required ?? false,
      actor.type,
      actor.id ?? null,
    ],
  )
  if (!row) throw new EngineError('Failed to create field.')
  return row
}

export interface UpdateFieldPatch {
  name?: string
  options?: FieldOptions
  required?: boolean
  position?: number
}

export async function updateField(
  orgId: string,
  tableId: string,
  fieldId: string,
  patch: UpdateFieldPatch,
): Promise<EngineField> {
  const existing = await getField(orgId, tableId, fieldId)
  if (!existing) throw new EngineError('Field not found.', 'not_found')

  const sets: string[] = []
  const params: unknown[] = [fieldId, tableId]
  if (patch.name !== undefined) {
    params.push(patch.name.trim())
    sets.push(`name = $${params.length}`)
  }
  if (patch.required !== undefined) {
    params.push(patch.required)
    sets.push(`required = $${params.length}`)
  }
  if (patch.position !== undefined) {
    params.push(patch.position)
    sets.push(`position = $${params.length}`)
  }
  if (patch.options !== undefined) {
    // Type is immutable in Phase A; validate the new options against the existing type.
    let options = validateFieldOptions(existing.type, patch.options)
    if (existing.type === 'linked_record') {
      // A linked_record field's target and its inverse pairing are structural: repointing
      // would orphan the far-side inverse field and every edge. Reject repoint; always keep
      // the existing inverseFieldId (never trust it from the patch — it's engine-owned).
      if (
        options.linkedTableId !== undefined &&
        options.linkedTableId !== existing.options.linkedTableId
      ) {
        throw new EngineError('Cannot repoint a linked field; delete and recreate it.', 'bad_input')
      }
      options = {
        ...options,
        linkedTableId: existing.options.linkedTableId,
        inverseFieldId: existing.options.inverseFieldId,
      }
    }
    // New options must re-pass the same DB-backed checks as on create: a formula's
    // expression, and a lookup/rollup's recordLinkFieldId / targetFieldId / filters.
    if (existing.type === 'formula' || existing.type === 'lookup' || existing.type === 'rollup') {
      await assertRelationOptions(orgId, tableId, existing.type, options)
    }
    params.push(JSON.stringify(options))
    sets.push(`options = $${params.length}::jsonb`)
  }
  if (sets.length === 0) return existing

  const row = await queryOne<EngineField>(
    `update public.engine_fields set ${sets.join(', ')}
     where id = $1 and table_id = $2
     returning ${FIELD_COLS}`,
    params,
  )
  if (!row) throw new EngineError('Field not found.', 'not_found')
  return row
}

export async function deleteField(orgId: string, tableId: string, fieldId: string): Promise<void> {
  await assertTable(orgId, tableId)
  const field = await queryOne<EngineField>(
    `select ${FIELD_COLS} from public.engine_fields where id = $1 and table_id = $2`,
    [fieldId, tableId],
  )
  if (!field) throw new EngineError('Field not found.', 'not_found')

  // A linked_record field is half of a pair — delete both sides (and, via FK cascade on
  // engine_record_links.field_id, every edge under either field). One transaction.
  if (field.type === 'linked_record') {
    const inverseId = field.options.inverseFieldId
    const pool = getPool()
    const client = await pool.connect()
    try {
      await client.query('begin')
      await client.query('delete from public.engine_fields where id = $1', [fieldId])
      if (inverseId) await client.query('delete from public.engine_fields where id = $1', [inverseId])
      await client.query('commit')
    } catch (err) {
      await client.query('rollback')
      throw err
    } finally {
      client.release()
    }
    return
  }

  await query('delete from public.engine_fields where id = $1 and table_id = $2', [fieldId, tableId])
  // NOTE: existing record values keyed by this field id are left in place (harmless
  // orphans); a Phase B cleanup could prune them. Renames are free because values key
  // on field id, so we intentionally do not touch record data on field delete.
}

export async function listFields(orgId: string, tableId: string): Promise<EngineField[]> {
  await assertTable(orgId, tableId)
  return query<EngineField>(
    `select ${FIELD_COLS} from public.engine_fields where table_id = $1
     order by position asc, created_at asc`,
    [tableId],
  )
}

export async function getField(
  orgId: string,
  tableId: string,
  fieldId: string,
): Promise<EngineField | null> {
  await assertTable(orgId, tableId)
  return queryOne<EngineField>(
    `select ${FIELD_COLS} from public.engine_fields where table_id = $1 and id = $2`,
    [tableId, fieldId],
  )
}

// ---------------------------------------------------------------------------
// Records (+ revisions)
// ---------------------------------------------------------------------------

/** Build a create-diff (every field: null -> value) for the revision log. */
function createDiff(values: Record<string, unknown>): RevisionDiff {
  const diff: RevisionDiff = {}
  for (const [k, v] of Object.entries(values)) diff[k] = { from: null, to: v }
  return diff
}

/** Build an update-diff by comparing old vs new values; only changed keys included. */
function updateDiff(before: Record<string, unknown>, after: Record<string, unknown>): RevisionDiff {
  const diff: RevisionDiff = {}
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const k of keys) {
    const from = before[k] ?? null
    const to = after[k] ?? null
    if (JSON.stringify(from) !== JSON.stringify(to)) diff[k] = { from, to }
  }
  return diff
}

/** Insert a revision row inside the given (transactional) client. */
async function writeRevision(
  client: { query: (t: string, p?: unknown[]) => Promise<unknown> },
  input: {
    recordId: string
    tableId: string
    orgId: string
    actor: Actor
    op: RevisionOp
    diff: RevisionDiff
  },
): Promise<void> {
  await client.query(
    `insert into public.engine_record_revisions
       (record_id, table_id, organization_id, actor_type, actor_id, op, diff)
     values ($1,$2,$3,$4::public.engine_actor_type,$5,$6,$7::jsonb)`,
    [
      input.recordId,
      input.tableId,
      input.orgId,
      input.actor.type,
      input.actor.id ?? null,
      input.op,
      JSON.stringify(input.diff),
    ],
  )
}

/** Split a coerced value map into stored jsonb values vs linked_record id-arrays. */
function splitLinkValues(
  fields: EngineField[],
  coerced: Record<string, unknown>,
): { stored: Record<string, unknown>; links: Map<string, string[]> } {
  const byId = new Map(fields.map((f) => [f.id, f]))
  const stored: Record<string, unknown> = {}
  const links = new Map<string, string[]>()
  for (const [fieldId, value] of Object.entries(coerced)) {
    const field = byId.get(fieldId)
    if (field?.type === 'linked_record') {
      links.set(fieldId, Array.isArray(value) ? (value as string[]) : [])
    } else {
      stored[fieldId] = value
    }
  }
  return { stored, links }
}

export async function createRecord(
  orgId: string,
  tableId: string,
  rawValues: Record<string, unknown>,
  actor: Actor,
): Promise<EngineRecord> {
  await assertTable(orgId, tableId)
  const fields = await listFields(orgId, tableId)

  // Coerce provided values (rejects computed-field writes), then separate linked_record
  // arrays out of the stored jsonb — the links join table is their source of truth.
  const coerced = coerceValues(fields, rawValues)
  const { stored, links } = splitLinkValues(fields, coerced)

  // Enforce required fields that were omitted entirely (linked_record required = non-empty).
  for (const f of fields) {
    if (!f.required) continue
    if (f.type === 'linked_record') {
      if ((links.get(f.id) ?? []).length === 0) throw new EngineError(`Field "${f.name}" is required.`, 'required')
    } else if (stored[f.id] === undefined || stored[f.id] === null) {
      throw new EngineError(`Field "${f.name}" is required.`, 'required')
    }
  }

  const pos = await nextPosition('engine_records', 'table_id', tableId)
  const autoFields = fields.filter((f) => f.type === 'autonumber')
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('begin')

    // Assign autonumbers from the per-table counter, bumped atomically in this tx.
    if (autoFields.length > 0) {
      const bumped = await client.query(
        `update public.engine_tables set autonumber_seq = autonumber_seq + 1
         where id = $1 returning autonumber_seq`,
        [tableId],
      )
      const seq = Number((bumped.rows[0] as { autonumber_seq: string }).autonumber_seq)
      for (const f of autoFields) stored[f.id] = seq
    }

    const res = await client.query(
      `insert into public.engine_records
         (table_id, organization_id, values, position, created_by_type, created_by_id)
       values ($1,$2,$3::jsonb,$4,$5::public.engine_actor_type,$6)
       returning ${RECORD_COLS}`,
      [tableId, orgId, JSON.stringify(stored), pos, actor.type, actor.id ?? null],
    )
    const record = res.rows[0] as EngineRecord

    // Sync link edges; record link changes in the create diff ({from:[], to:[ids]}).
    const linkDiff: RevisionDiff = {}
    for (const [fieldId, ids] of links) {
      const field = fields.find((f) => f.id === fieldId)!
      await syncLinksForField(client, orgId, field, record.id, ids)
      if (ids.length) linkDiff[fieldId] = { from: [], to: ids }
    }

    await writeRevision(client, {
      recordId: record.id,
      tableId,
      orgId,
      actor,
      op: 'create',
      diff: { ...createDiff(stored), ...linkDiff },
    })
    await client.query('commit')
    return record
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    client.release()
  }
}

export async function updateRecord(
  orgId: string,
  tableId: string,
  recordId: string,
  rawPatch: Record<string, unknown>,
  actor: Actor,
): Promise<EngineRecord> {
  await assertTable(orgId, tableId)
  const fields = await listFields(orgId, tableId)
  const byId = new Map(fields.map((f) => [f.id, f]))
  const existing = await getRecord(orgId, tableId, recordId)
  if (!existing) throw new EngineError('Record not found.', 'not_found')

  const coerced = coerceValues(fields, rawPatch)
  const { stored: storedPatch, links: linkPatch } = splitLinkValues(fields, coerced)
  const before = existing.values
  const after = { ...before, ...storedPatch }

  // Enforce required on any non-link field the patch tries to clear.
  for (const f of fields) {
    if (!f.required || f.type === 'linked_record') continue
    if (after[f.id] === undefined || after[f.id] === null) {
      throw new EngineError(`Field "${f.name}" is required.`, 'required')
    }
  }
  // Required linked_record fields may not be cleared to empty.
  for (const [fieldId, ids] of linkPatch) {
    const f = byId.get(fieldId)!
    if (f.required && ids.length === 0) throw new EngineError(`Field "${f.name}" is required.`, 'required')
  }

  const diff = updateDiff(before, after)
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('begin')
    const res = await client.query(
      `update public.engine_records set values = $3::jsonb
       where organization_id = $1 and id = $2 and table_id = $4
       returning ${RECORD_COLS}`,
      [orgId, recordId, JSON.stringify(after), tableId],
    )
    const record = res.rows[0] as EngineRecord

    // Sync any linked_record fields in the patch; diff records {from:[old], to:[new]}.
    // NOTE: a link change is intentionally logged as a revision only on the EDITED side —
    // the far-side record's inverse field sees the same edge but gets no revision row (its
    // history would otherwise gain entries no actor on that record ever made).
    for (const [fieldId, ids] of linkPatch) {
      const field = byId.get(fieldId)!
      const oldIds = await syncLinksForField(client, orgId, field, recordId, ids)
      if (JSON.stringify(oldIds) !== JSON.stringify(ids)) diff[fieldId] = { from: oldIds, to: ids }
    }

    // Only log a revision if something actually changed (values or links).
    if (Object.keys(diff).length > 0) {
      await writeRevision(client, { recordId, tableId, orgId, actor, op: 'update', diff })
    }
    await client.query('commit')
    return record
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    client.release()
  }
}

export async function deleteRecords(
  orgId: string,
  tableId: string,
  recordIds: string[],
  actor: Actor,
): Promise<{ deleted: number }> {
  await assertTable(orgId, tableId)
  if (recordIds.length === 0) return { deleted: 0 }

  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('begin')
    const found = await client.query(
      `select ${RECORD_COLS} from public.engine_records
       where organization_id = $1 and table_id = $2 and id = any($3::uuid[])`,
      [orgId, tableId, recordIds],
    )
    const records = found.rows as EngineRecord[]
    for (const r of records) {
      const diff: RevisionDiff = {}
      for (const [k, v] of Object.entries(r.values)) diff[k] = { from: v, to: null }
      await writeRevision(client, { recordId: r.id, tableId, orgId, actor, op: 'delete', diff })
    }
    const del = await client.query(
      'delete from public.engine_records where organization_id = $1 and table_id = $2 and id = any($3::uuid[]) returning id',
      [orgId, tableId, recordIds],
    )
    await client.query('commit')
    return { deleted: del.rowCount ?? 0 }
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    client.release()
  }
}

/** Raw record read (no `display` map). Used internally on the write paths. */
export async function getRecord(
  orgId: string,
  tableId: string,
  recordId: string,
): Promise<EngineRecord | null> {
  return queryOne<EngineRecord>(
    `select ${RECORD_COLS} from public.engine_records
     where organization_id = $1 and table_id = $2 and id = $3`,
    [orgId, tableId, recordId],
  )
}

/** Enriched record read: raw `values` (with linked-record id arrays projected) + `display`. */
export async function getRecordEnriched(
  orgId: string,
  tableId: string,
  recordId: string,
): Promise<EnrichedRecord | null> {
  const record = await getRecord(orgId, tableId, recordId)
  if (!record) return null
  const fields = await listFields(orgId, tableId)
  const [enriched] = await enrichRecords(orgId, fields, [record])
  return enriched ?? null
}

export interface QueryRecordsOptions {
  filters?: FilterCondition[]
  sorts?: SortSpec[]
  limit?: number
  offset?: number
}

export interface QueryRecordsResult {
  records: EnrichedRecord[]
  total: number
  limit: number
  offset: number
}

/**
 * Query records by field values with filter / sort / pagination. Filters and sorts
 * operate on values ->> '<fieldId>' (jsonb). Numeric/date comparisons cast the text out
 * of jsonb; string ops use ilike. This is deliberately simple for Phase A — good enough
 * for the grid view and the API, extended in Phase B (linked/rollup filters).
 */
export async function queryRecords(
  orgId: string,
  tableId: string,
  opts: QueryRecordsOptions = {},
): Promise<QueryRecordsResult> {
  await assertTable(orgId, tableId)
  const fields = await listFields(orgId, tableId)
  const byId = new Map(fields.map((f) => [f.id, f]))

  const where: string[] = ['organization_id = $1', 'table_id = $2']
  const params: unknown[] = [orgId, tableId]

  for (const f of opts.filters ?? []) {
    const field = byId.get(f.fieldId)
    if (!field) throw new EngineError(`Unknown field id "${f.fieldId}" in filter.`, 'unknown_field')
    if (isComputedType(field.type) || field.type === 'linked_record') {
      throw new EngineError(`Cannot filter on the computed/linked field "${field.name}".`, 'bad_input')
    }
    const numeric = field.type === 'number' || field.type === 'currency' || field.type === 'percent'
    const path = `(values ->> ${pushParam(params, f.fieldId)})`
    const lhs = numeric ? `(${path})::numeric` : path
    switch (f.op) {
      case 'is_empty':
        where.push(`(${path} is null or ${path} = '')`)
        break
      case 'is_not_empty':
        where.push(`(${path} is not null and ${path} <> '')`)
        break
      case 'eq':
        where.push(`${lhs} = ${castRhs(params, f.value, numeric)}`)
        break
      case 'neq':
        where.push(`${lhs} is distinct from ${castRhs(params, f.value, numeric)}`)
        break
      case 'contains':
        where.push(`${path} ilike ${pushParam(params, `%${String(f.value ?? '')}%`)}`)
        break
      case 'gt':
        where.push(`${lhs} > ${castRhs(params, f.value, numeric)}`)
        break
      case 'gte':
        where.push(`${lhs} >= ${castRhs(params, f.value, numeric)}`)
        break
      case 'lt':
        where.push(`${lhs} < ${castRhs(params, f.value, numeric)}`)
        break
      case 'lte':
        where.push(`${lhs} <= ${castRhs(params, f.value, numeric)}`)
        break
      default:
        throw new EngineError(`Unsupported filter op "${String(f.op)}".`, 'bad_filter')
    }
  }

  const whereSql = where.join(' and ')
  // Snapshot the params that the WHERE clause references, before the sort loop and
  // limit/offset push more onto the same array — the COUNT query uses only these.
  const whereParams = [...params]

  const orderParts: string[] = []
  for (const s of opts.sorts ?? []) {
    const field = byId.get(s.fieldId)
    if (!field) throw new EngineError(`Unknown field id "${s.fieldId}" in sort.`, 'unknown_field')
    if (isComputedType(field.type) || field.type === 'linked_record') {
      throw new EngineError(`Cannot sort on the computed/linked field "${field.name}".`, 'bad_input')
    }
    const numeric = field.type === 'number' || field.type === 'currency' || field.type === 'percent'
    const expr = numeric
      ? `(values ->> ${pushParam(params, s.fieldId)})::numeric`
      : `(values ->> ${pushParam(params, s.fieldId)})`
    const dir = s.direction === 'desc' ? 'desc' : 'asc'
    orderParts.push(`${expr} ${dir} nulls last`)
  }
  orderParts.push('created_at asc')
  const orderSql = orderParts.join(', ')

  const totalRow = await queryOne<{ count: string }>(
    `select count(*)::int as count from public.engine_records where ${whereSql}`,
    whereParams,
  )
  const total = totalRow ? Number(totalRow.count) : 0

  if (opts.limit !== undefined && !Number.isFinite(opts.limit)) {
    throw new EngineError(`Invalid limit "${String(opts.limit)}".`, 'bad_input')
  }
  if (opts.offset !== undefined && !Number.isFinite(opts.offset)) {
    throw new EngineError(`Invalid offset "${String(opts.offset)}".`, 'bad_input')
  }
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500)
  const offset = Math.max(opts.offset ?? 0, 0)
  params.push(limit)
  const limitP = `$${params.length}`
  params.push(offset)
  const offsetP = `$${params.length}`

  const rawRecords = await query<EngineRecord>(
    `select ${RECORD_COLS} from public.engine_records
     where ${whereSql} order by ${orderSql} limit ${limitP} offset ${offsetP}`,
    params,
  )
  // Enrich the page (linked-record labels, lookups, rollups) with batched queries.
  const records = await enrichRecords(orgId, fields, rawRecords)
  return { records, total, limit, offset }
}

function pushParam(params: unknown[], value: unknown): string {
  params.push(value)
  return `$${params.length}`
}

function castRhs(params: unknown[], value: unknown, numeric: boolean): string {
  if (numeric) {
    params.push(Number(value))
    return `$${params.length}::numeric`
  }
  params.push(value === null || value === undefined ? '' : String(value))
  return `$${params.length}`
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface CreateViewInput {
  name: string
  type?: ViewType
  config?: ViewConfig
  position?: number
}

export async function createView(
  orgId: string,
  tableId: string,
  input: CreateViewInput,
): Promise<EngineView> {
  await assertTable(orgId, tableId)
  if (!input.name?.trim()) throw new EngineError('View name is required.', 'bad_input')
  const type: ViewType = input.type ?? 'grid'
  if (type !== 'grid' && type !== 'kanban') throw new EngineError(`Unknown view type "${type}".`, 'bad_type')
  const pos = input.position ?? (await nextPosition('engine_views', 'table_id', tableId))
  const row = await queryOne<EngineView>(
    `insert into public.engine_views (table_id, name, type, config, position)
     values ($1,$2,$3,$4::jsonb,$5)
     returning ${VIEW_COLS}`,
    [tableId, input.name.trim(), type, JSON.stringify(input.config ?? {}), pos],
  )
  if (!row) throw new EngineError('Failed to create view.')
  return row
}

export interface UpdateViewPatch {
  name?: string
  type?: ViewType
  config?: ViewConfig
  position?: number
}

export async function updateView(
  orgId: string,
  tableId: string,
  viewId: string,
  patch: UpdateViewPatch,
): Promise<EngineView> {
  await assertTable(orgId, tableId)
  const sets: string[] = []
  const params: unknown[] = [viewId, tableId]
  if (patch.name !== undefined) {
    params.push(patch.name.trim())
    sets.push(`name = $${params.length}`)
  }
  if (patch.type !== undefined) {
    params.push(patch.type)
    sets.push(`type = $${params.length}`)
  }
  if (patch.position !== undefined) {
    params.push(patch.position)
    sets.push(`position = $${params.length}`)
  }
  if (patch.config !== undefined) {
    params.push(JSON.stringify(patch.config))
    sets.push(`config = $${params.length}::jsonb`)
  }
  if (sets.length === 0) {
    const existing = await getView(orgId, tableId, viewId)
    if (!existing) throw new EngineError('View not found.', 'not_found')
    return existing
  }
  const row = await queryOne<EngineView>(
    `update public.engine_views set ${sets.join(', ')}
     where id = $1 and table_id = $2 returning ${VIEW_COLS}`,
    params,
  )
  if (!row) throw new EngineError('View not found.', 'not_found')
  return row
}

export async function deleteView(orgId: string, tableId: string, viewId: string): Promise<void> {
  await assertTable(orgId, tableId)
  const res = await query<{ id: string }>(
    'delete from public.engine_views where id = $1 and table_id = $2 returning id',
    [viewId, tableId],
  )
  if (res.length === 0) throw new EngineError('View not found.', 'not_found')
}

export async function listViews(orgId: string, tableId: string): Promise<EngineView[]> {
  await assertTable(orgId, tableId)
  return query<EngineView>(
    `select ${VIEW_COLS} from public.engine_views where table_id = $1
     order by position asc, created_at asc`,
    [tableId],
  )
}

export async function getView(
  orgId: string,
  tableId: string,
  viewId: string,
): Promise<EngineView | null> {
  await assertTable(orgId, tableId)
  return queryOne<EngineView>(
    `select ${VIEW_COLS} from public.engine_views where table_id = $1 and id = $2`,
    [tableId, viewId],
  )
}

// ---------------------------------------------------------------------------
// Revisions (audit trail reads — the UI history panel lands in Phase C)
// ---------------------------------------------------------------------------

export async function listRecordRevisions(
  orgId: string,
  recordId: string,
  limit = 100,
): Promise<EngineRecordRevision[]> {
  return query<EngineRecordRevision>(
    `select ${REVISION_COLS} from public.engine_record_revisions
     where organization_id = $1 and record_id = $2
     order by created_at desc limit $3`,
    [orgId, recordId, limit],
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Next append position = max(position)+1 within a parent scope. */
async function nextPosition(
  table: 'engine_tables' | 'engine_fields' | 'engine_records' | 'engine_views',
  scopeCol: 'organization_id' | 'table_id',
  scopeVal: string,
): Promise<number> {
  const row = await queryOne<{ max: number | null }>(
    `select max(position) as max from public.${table} where ${scopeCol} = $1`,
    [scopeVal],
  )
  return (row?.max ?? -1) + 1
}
