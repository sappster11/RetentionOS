// @retentionos/engine — the ONE service layer under the meta-schema (agent-parity law).
// The web UI (via its REST API), n8n webhooks, and the future MCP server are all clients
// of these functions. There is no second, UI-only path. Every function is tenant-scoped by
// organizationId, and every record mutation writes an engine_record_revisions row so the
// audit trail (human-vs-agent-vs-api) is complete without the caller remembering to.

import { randomBytes } from 'node:crypto'
import { getPool, query, queryOne, slugify } from '@retentionos/db'
import { coerceValue, coerceValues, isFieldType, validateFieldOptions } from './fieldTypes'
import { parseFormula, referencedFieldIds } from './formula'
import { enrichRecords, syncLinksForField } from './links'
import { enqueueAutomationRuns } from './automationShared'
import {
  EngineError,
  FormSubmissionError,
  VIEW_TYPES,
  isComputedType,
  isRelativeDateFilterOp,
} from './types'
import type {
  Actor,
  EngineBase,
  EngineField,
  EngineRecord,
  EngineRecordRevision,
  EngineTable,
  EngineView,
  EnrichedRecord,
  FieldOptions,
  FieldType,
  FilterCondition,
  FormFieldConfig,
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
const BASE_COLS = `
  id, organization_id, name, slug, icon, position,
  created_by_type, created_by_id, created_at, updated_at`
const TABLE_COLS = `
  id, organization_id, name, slug, icon, description, base_id, position,
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
// Bases — workspace groupings of tables ("Sales CRM", "Client Hub").
// ---------------------------------------------------------------------------

export interface CreateBaseInput {
  name: string
  slug?: string
  icon?: string | null
}

/** Ensure the base slug is unique within the org, suffixing -2, -3, … if needed. */
async function uniqueBaseSlug(orgId: string, base: string): Promise<string> {
  const root = slugify(base) || 'base'
  let candidate = root
  let n = 1
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const clash = await queryOne<{ id: string }>(
      'select id from public.engine_bases where organization_id = $1 and slug = $2',
      [orgId, candidate],
    )
    if (!clash) return candidate
    n += 1
    candidate = `${root}-${n}`
  }
}

export async function createBase(
  orgId: string,
  input: CreateBaseInput,
  actor: Actor,
): Promise<EngineBase> {
  if (!input.name?.trim()) throw new EngineError('Base name is required.', 'bad_input')
  const slug = await uniqueBaseSlug(orgId, input.slug ?? input.name)
  const pos = await nextPosition('engine_bases', 'organization_id', orgId)
  const row = await queryOne<EngineBase>(
    `insert into public.engine_bases
       (organization_id, name, slug, icon, position, created_by_type, created_by_id)
     values ($1,$2,$3,$4,$5,$6::public.engine_actor_type,$7)
     returning ${BASE_COLS}`,
    [orgId, input.name.trim(), slug, input.icon ?? null, pos, actor.type, actor.id ?? null],
  )
  if (!row) throw new EngineError('Failed to create base.')
  return row
}

export interface UpdateBasePatch {
  name?: string
  icon?: string | null
  position?: number
}

export async function updateBase(
  orgId: string,
  baseId: string,
  patch: UpdateBasePatch,
): Promise<EngineBase> {
  const sets: string[] = []
  const params: unknown[] = [orgId, baseId]
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new EngineError('Base name is required.', 'bad_input')
    params.push(patch.name.trim())
    sets.push(`name = $${params.length}`)
  }
  if (patch.icon !== undefined) {
    params.push(patch.icon)
    sets.push(`icon = $${params.length}`)
  }
  if (patch.position !== undefined) {
    params.push(patch.position)
    sets.push(`position = $${params.length}`)
  }
  if (sets.length === 0) {
    const existing = await getBase(orgId, baseId)
    if (!existing) throw new EngineError('Base not found.', 'not_found')
    return existing
  }
  const row = await queryOne<EngineBase>(
    `update public.engine_bases set ${sets.join(', ')}
     where organization_id = $1 and id = $2
     returning ${BASE_COLS}`,
    params,
  )
  if (!row) throw new EngineError('Base not found.', 'not_found')
  return row
}

/** Delete a base — only when EMPTY. A base that still contains tables is rejected
 * (bad_input): move its tables to another base (or ungroup them) first. */
export async function deleteBase(orgId: string, baseId: string): Promise<void> {
  const base = await getBase(orgId, baseId)
  if (!base) throw new EngineError('Base not found.', 'not_found')
  const occupied = await queryOne<{ id: string }>(
    'select id from public.engine_tables where organization_id = $1 and base_id = $2 limit 1',
    [orgId, baseId],
  )
  if (occupied) {
    throw new EngineError(
      'Base still contains tables — move or delete them before deleting the base.',
      'bad_input',
    )
  }
  await query('delete from public.engine_bases where organization_id = $1 and id = $2', [
    orgId,
    baseId,
  ])
}

export async function listBases(orgId: string): Promise<EngineBase[]> {
  return query<EngineBase>(
    `select ${BASE_COLS} from public.engine_bases
     where organization_id = $1 order by position asc, created_at asc`,
    [orgId],
  )
}

export async function getBase(orgId: string, baseId: string): Promise<EngineBase | null> {
  return queryOne<EngineBase>(
    `select ${BASE_COLS} from public.engine_bases where organization_id = $1 and id = $2`,
    [orgId, baseId],
  )
}

export async function getBaseBySlug(orgId: string, slug: string): Promise<EngineBase | null> {
  return queryOne<EngineBase>(
    `select ${BASE_COLS} from public.engine_bases where organization_id = $1 and slug = $2`,
    [orgId, slug],
  )
}

/** Confirm a base belongs to the org (used before table create/move). */
async function assertBase(orgId: string, baseId: string): Promise<EngineBase> {
  const b = await getBase(orgId, baseId)
  if (!b) throw new EngineError('baseId does not reference a base in this org.', 'bad_input')
  return b
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export interface CreateTableInput {
  name: string
  slug?: string
  icon?: string | null
  description?: string | null
  /** Base to create the table in; omitted/null = ungrouped ("Workspace"). */
  baseId?: string | null
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
  if (input.baseId) await assertBase(orgId, input.baseId)
  const slug = await uniqueTableSlug(orgId, input.slug ?? input.name)
  const pos = await nextPosition('engine_tables', 'organization_id', orgId)
  const row = await queryOne<EngineTable>(
    `insert into public.engine_tables
       (organization_id, name, slug, icon, description, base_id, position, created_by_type, created_by_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8::public.engine_actor_type,$9)
     returning ${TABLE_COLS}`,
    [orgId, input.name.trim(), slug, input.icon ?? null, input.description ?? null, input.baseId ?? null, pos, actor.type, actor.id ?? null],
  )
  if (!row) throw new EngineError('Failed to create table.')
  return row
}

export interface UpdateTablePatch {
  name?: string
  icon?: string | null
  description?: string | null
  /** Move the table into a base (uuid) or ungroup it (null). */
  baseId?: string | null
  position?: number
}

export async function updateTable(
  orgId: string,
  tableId: string,
  patch: UpdateTablePatch,
): Promise<EngineTable> {
  if (patch.baseId != null) await assertBase(orgId, patch.baseId)
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
  if (patch.baseId !== undefined) {
    params.push(patch.baseId)
    sets.push(`base_id = $${params.length}`)
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
 *  - lookup/rollup.targetFieldId must be either a CONCRETE (non-computed) field on the
 *    linked table, or — depth-2 chaining — a LOOKUP on the linked table whose own
 *    targetFieldId resolves to a concrete field one hop further. Exactly one extra hop:
 *    a lookup-of-lookup-of-lookup, or a rollup/formula target, is rejected. Count rollups
 *    may omit targetFieldId.
 *  - lookup/rollup.filters[].fieldId must each be a CONCRETE (non-computed, non-linked,
 *    non-multi_select) field on the linked table (their conditions evaluate against
 *    linked-row values); relative-date ops additionally require a date/datetime field.
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
      if (targetField.type === 'lookup') {
        // Depth-2 chaining: the target may be a lookup ON the linked table, but only when
        // that lookup itself lands on a CONCRETE field one hop further (never deeper).
        const hopLinkField = await queryOne<EngineField>(
          `select ${FIELD_COLS} from public.engine_fields where table_id = $1 and id = $2`,
          [targetTableId, targetField.options.recordLinkFieldId],
        )
        if (!hopLinkField || hopLinkField.type !== 'linked_record' || !targetField.options.targetFieldId) {
          throw new EngineError(
            `targetFieldId chains through the lookup "${targetField.name}", which is misconfigured (its link or target is gone).`,
            'bad_options',
          )
        }
        const hopTarget = await queryOne<EngineField>(
          `select ${FIELD_COLS} from public.engine_fields where table_id = $1 and id = $2`,
          [hopLinkField.options.linkedTableId, targetField.options.targetFieldId],
        )
        if (!hopTarget) {
          throw new EngineError(
            `targetFieldId chains through the lookup "${targetField.name}", whose own target field no longer exists.`,
            'bad_options',
          )
        }
        if (isComputedType(hopTarget.type)) {
          throw new EngineError(
            `targetFieldId may chain through at most ONE lookup: "${targetField.name}" targets the computed field "${hopTarget.name}" (${hopTarget.type}) — the chained lookup must land on a concrete field.`,
            'bad_options',
          )
        }
      } else if (isComputedType(targetField.type)) {
        throw new EngineError(
          `targetFieldId must be a concrete field, or a lookup on the linked table (depth-2) — "${targetField.name}" is a ${targetField.type}.`,
          'bad_options',
        )
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
        // TODO: allow multi_select filter fields once array-membership ("has choice") semantics land.
        if (ff.type === 'multi_select') {
          throw new EngineError(
            `Filter field "${ff.name}" is a multi_select — multi_select fields cannot be used in lookup/rollup filters yet.`,
            'bad_options',
          )
        }
        if (isRelativeDateFilterOp(c.op) && ff.type !== 'date' && ff.type !== 'datetime') {
          throw new EngineError(
            `Filter op "${c.op}" only applies to date/datetime fields; "${ff.name}" is ${ff.type}.`,
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
    // Transactional outbox: matching enabled automations enqueue runs in THIS tx, so a
    // committed record change can never miss its automations (docs/11).
    await enqueueAutomationRuns(client, {
      orgId,
      tableId,
      recordId: record.id,
      op: 'create',
      diff: { ...createDiff(stored), ...linkDiff },
      actor,
      values: { ...record.values, ...Object.fromEntries([...links].map(([k, v]) => [k, v])) },
      fields,
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
      // Transactional outbox (docs/11): same-tx enqueue for matching automations.
      await enqueueAutomationRuns(client, {
        orgId,
        tableId,
        recordId,
        op: 'update',
        diff,
        actor,
        values: { ...after, ...Object.fromEntries([...linkPatch].map(([k, v]) => [k, v])) },
        fields,
      })
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
      case 'on_or_before_today':
      case 'on_or_after_today': {
        // Relative-date ops: valueless, date/datetime only, evaluated at QUERY time.
        // date fields compare by calendar date, datetime fields by instant vs now().
        if (field.type !== 'date' && field.type !== 'datetime') {
          throw new EngineError(
            `Filter op "${f.op}" only applies to date/datetime fields; "${field.name}" is ${field.type}.`,
            'bad_filter',
          )
        }
        if (f.value !== undefined) {
          throw new EngineError(`Filter op "${f.op}" does not take a value.`, 'bad_filter')
        }
        const cmp = f.op === 'on_or_before_today' ? '<=' : '>='
        // nullif guards the cast: an absent/empty stored value compares as null → excluded.
        where.push(
          field.type === 'date'
            ? `(nullif(${path}, ''))::date ${cmp} current_date`
            : `(nullif(${path}, ''))::timestamptz ${cmp} now()`,
        )
        break
      }
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
  if (!VIEW_TYPES.includes(type)) throw new EngineError(`Unknown view type "${type}".`, 'bad_type')
  let config: ViewConfig = input.config ?? {}
  if (type === 'form') {
    config = await validateFormConfig(orgId, tableId, config, { nameForSlug: input.name.trim() })
  }
  const pos = input.position ?? (await nextPosition('engine_views', 'table_id', tableId))
  const row = await queryOne<EngineView>(
    `insert into public.engine_views (table_id, name, type, config, position)
     values ($1,$2,$3,$4::jsonb,$5)
     returning ${VIEW_COLS}`,
    [tableId, input.name.trim(), type, JSON.stringify(config), pos],
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
  const existing = await getView(orgId, tableId, viewId)
  if (!existing) throw new EngineError('View not found.', 'not_found')
  if (patch.type !== undefined && !VIEW_TYPES.includes(patch.type)) {
    throw new EngineError(`Unknown view type "${patch.type}".`, 'bad_type')
  }

  // If the view is (or becomes) a form, its config must (re)validate as a form config.
  // publicSlug is engine-owned once minted: an existing slug always survives the patch
  // (like a linked field's inverseFieldId) so a published /f/ URL can never break.
  const nextType: ViewType = patch.type ?? existing.type
  let config = patch.config
  if (nextType === 'form' && (patch.config !== undefined || patch.type !== undefined)) {
    const proposed: ViewConfig = patch.config ?? existing.config
    config = await validateFormConfig(
      orgId,
      tableId,
      { ...proposed, publicSlug: existing.config.publicSlug ?? proposed.publicSlug },
      { nameForSlug: patch.name?.trim() || existing.name, excludeViewId: viewId },
    )
  } else if (config !== undefined && 'publicSlug' in config) {
    // Non-form views are never served at /f/<slug>, so a grid/kanban config must not
    // store a publicSlug — it would silently squat the app-global form-slug namespace.
    const { publicSlug: _dropped, ...rest } = config
    config = rest
  }

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
  if (config !== undefined) {
    params.push(JSON.stringify(config))
    sets.push(`config = $${params.length}::jsonb`)
  }
  if (sets.length === 0) return existing
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
// Forms — a view of type 'form' exposes a PUBLIC intake page at /f/<publicSlug>
// (no auth). The form's config lives on the view (title/description/submitLabel/
// publicSlug/fields); submissions come back through submitForm, which validates
// form-level required-ness, coerces via the same per-type coercion as every other
// write path, and creates the record attributed to actor {type:'api', id:'form:<slug>'}.
// ---------------------------------------------------------------------------

/** Lowercase url-safe slug: letters/digits with inner hyphens ("leads-intake-x7k2p9"). */
const FORM_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

/**
 * Which field types a public form may write. Computed types are never writable, and
 * linked_record is excluded in v1 — a public form must not expose record search/pickers
 * over org data. (Linked-record form fields are a fast-follow behind a scoping design.)
 */
export function isFormWritableType(t: FieldType): boolean {
  return !isComputedType(t) && t !== 'linked_record'
}

/** True if any OTHER form view (any org — the /f/ URL space is app-global) owns the slug. */
async function formSlugTaken(slug: string, excludeViewId?: string): Promise<boolean> {
  const params: unknown[] = [slug]
  let exclude = ''
  if (excludeViewId) {
    params.push(excludeViewId)
    exclude = ' and id <> $2'
  }
  const clash = await queryOne<{ id: string }>(
    `select id from public.engine_views
     where type = 'form' and config ->> 'publicSlug' = $1${exclude} limit 1`,
    params,
  )
  return !!clash
}

/** Mint a unique public slug: slugified base + a crypto-random 10-hex-char token
 * ("leads-3f9a1c04be"). The token comes from node:crypto (not Math.random) — /f/ slugs are
 * unauthenticated capability URLs, so they must not be guessable from a seeded PRNG.
 * NOTE: the check-then-insert here still races under concurrency; the eventual fix is a
 * partial unique index on (config->>'publicSlug') where type = 'form'. */
async function uniqueFormSlug(base: string): Promise<string> {
  const root = slugify(base) || 'form'
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = `${root}-${randomBytes(5).toString('hex')}`
    if (FORM_SLUG_RE.test(candidate) && !(await formSlugTaken(candidate))) return candidate
  }
}

/** Reject a non-string / empty-after-trim optional text config key; return the trimmed value. */
function optionalText(value: unknown, key: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    throw new EngineError(`Form config.${key} must be a string.`, 'bad_options')
  }
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

/**
 * Validate + normalize a form view's config. Enforces: fields[] reference real, form-
 * writable fields on THIS table (no computed, no linked_record, no duplicates); text keys
 * are strings; publicSlug is url-safe and unique (minted here when absent). Grid-only keys
 * (filters/sorts/…) are dropped — they don't apply to a form.
 */
async function validateFormConfig(
  orgId: string,
  tableId: string,
  config: ViewConfig,
  opts: { nameForSlug: string; excludeViewId?: string },
): Promise<ViewConfig> {
  const tableFields = await listFields(orgId, tableId)
  const byId = new Map(tableFields.map((f) => [f.id, f]))

  const rawFields = config.fields ?? []
  if (!Array.isArray(rawFields)) {
    throw new EngineError('Form config.fields must be an array.', 'bad_options')
  }
  const seen = new Set<string>()
  const fields: FormFieldConfig[] = rawFields.map((fc) => {
    if (typeof fc !== 'object' || fc === null || typeof fc.fieldId !== 'string' || !fc.fieldId) {
      throw new EngineError('Each form field needs a string fieldId.', 'bad_options')
    }
    const field = byId.get(fc.fieldId)
    if (!field) {
      throw new EngineError(`Form field "${fc.fieldId}" is not a field on this table.`, 'bad_options')
    }
    if (!isFormWritableType(field.type)) {
      throw new EngineError(
        `Form field "${field.name}" is ${field.type} — computed and linked-record fields cannot be on a public form.`,
        'bad_options',
      )
    }
    if (seen.has(fc.fieldId)) {
      throw new EngineError(`Form field "${field.name}" appears more than once.`, 'bad_options')
    }
    seen.add(fc.fieldId)
    const label = optionalText(fc.label, 'fields[].label')
    const helpText = optionalText(fc.helpText, 'fields[].helpText')
    return {
      fieldId: fc.fieldId,
      required: fc.required === true,
      ...(label ? { label } : {}),
      ...(helpText ? { helpText } : {}),
    }
  })

  let publicSlug = config.publicSlug
  if (publicSlug !== undefined) {
    if (typeof publicSlug !== 'string' || !FORM_SLUG_RE.test(publicSlug)) {
      throw new EngineError(
        'Form publicSlug must be url-safe: lowercase letters, digits, and inner hyphens.',
        'bad_options',
      )
    }
    if (await formSlugTaken(publicSlug, opts.excludeViewId)) {
      throw new EngineError(`Form slug "${publicSlug}" is already in use.`, 'bad_options')
    }
  } else {
    publicSlug = await uniqueFormSlug(optionalText(config.title, 'title') ?? opts.nameForSlug)
  }

  const out: ViewConfig = { fields, publicSlug }
  const title = optionalText(config.title, 'title')
  if (title) out.title = title
  const description = optionalText(config.description, 'description')
  if (description) out.description = description
  const submitLabel = optionalText(config.submitLabel, 'submitLabel')
  if (submitLabel) out.submitLabel = submitLabel
  return out
}

/** A form field resolved for rendering: the live field definition + form-level settings. */
export interface FormField {
  field: EngineField
  required: boolean
  label: string
  helpText?: string
}

/** Everything a form renderer needs: the view, its table, and the resolved fields in order. */
export interface FormDescriptor {
  view: EngineView
  table: EngineTable
  fields: FormField[]
}

/**
 * Resolve a public form by its slug — the PUBLIC read used by /f/[slug] (no auth), so org
 * is optional: omitted, the slug is looked up app-wide (slugs are globally unique). Fields
 * that were deleted (or are no longer form-writable) since the config was saved are
 * silently skipped rather than breaking the whole form.
 */
export async function getFormBySlug(slug: string, orgId?: string): Promise<FormDescriptor | null> {
  if (!slug) return null
  const params: unknown[] = [slug]
  let orgClause = ''
  if (orgId) {
    params.push(orgId)
    orgClause = ' and t.organization_id = $2'
  }
  const row = await queryOne<EngineView & { organization_id: string }>(
    `select v.id, v.table_id, v.name, v.type, v.config, v.position, v.created_at, v.updated_at,
            t.organization_id
     from public.engine_views v
     join public.engine_tables t on t.id = v.table_id
     where v.type = 'form' and v.config ->> 'publicSlug' = $1${orgClause}
     limit 1`,
    params,
  )
  if (!row) return null
  const { organization_id, ...view } = row
  const table = await getTable(organization_id, view.table_id)
  if (!table) return null
  const tableFields = await listFields(organization_id, view.table_id)
  const byId = new Map(tableFields.map((f) => [f.id, f]))
  const fields: FormField[] = []
  for (const fc of view.config.fields ?? []) {
    const field = byId.get(fc.fieldId)
    if (!field || !isFormWritableType(field.type)) continue
    fields.push({
      field,
      required: fc.required === true,
      label: fc.label?.trim() || field.name,
      ...(fc.helpText ? { helpText: fc.helpText } : {}),
    })
  }
  return { view: view as EngineView, table, fields }
}

/**
 * Handle a public form submission. Validates form-level required-ness and coerces every
 * provided value through the same per-type coercion as any other write; per-field problems
 * are collected into ONE FormSubmissionError (code 'form_validation', .fieldErrors keyed by
 * fieldId) so the renderer can show them inline. On success the record is created with
 * actor {type:'api', id:'form:<slug>'} — which also writes the create revision.
 */
export async function submitForm(
  slug: string,
  rawValues: Record<string, unknown>,
): Promise<{ record: EngineRecord; form: FormDescriptor }> {
  const form = await getFormBySlug(slug)
  if (!form) throw new EngineError('Form not found.', 'not_found')

  const byId = new Map(form.fields.map((ff) => [ff.field.id, ff]))
  for (const key of Object.keys(rawValues)) {
    if (!byId.has(key)) {
      throw new EngineError(`Field "${key}" is not on this form.`, 'unknown_field')
    }
  }

  const fieldErrors: Record<string, string> = {}
  const coerced: Record<string, unknown> = {}
  for (const ff of form.fields) {
    const raw = rawValues[ff.field.id]
    const empty =
      raw === null || raw === undefined || raw === '' || (Array.isArray(raw) && raw.length === 0)
    if (empty) {
      if (ff.required) fieldErrors[ff.field.id] = `${ff.label} is required.`
      continue
    }
    try {
      coerced[ff.field.id] = coerceValue(ff.field, raw)
    } catch (err) {
      if (err instanceof EngineError) fieldErrors[ff.field.id] = err.message
      else throw err
    }
  }
  // Engine-required fields must be satisfiable through this form, so createRecord's
  // 'required' EngineError (which names internal fields) can never escape to the public
  // surface. On the form → behaves like a form-required miss (inline field error). NOT on
  // the form → the submission can never succeed; fail with one generic form-level message
  // that leaks no field names.
  const tableFields = await listFields(form.table.organization_id, form.table.id)
  for (const field of tableFields) {
    if (!field.required) continue
    const ff = byId.get(field.id)
    if (!ff) {
      throw new FormSubmissionError(
        'This form is missing a required field — contact the form owner.',
        {},
      )
    }
    const raw = rawValues[field.id]
    const empty =
      raw === null || raw === undefined || raw === '' || (Array.isArray(raw) && raw.length === 0)
    if (empty && !fieldErrors[field.id]) {
      fieldErrors[field.id] = `${ff.label} is required.`
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw new FormSubmissionError('Some answers need attention.', fieldErrors)
  }

  const record = await createRecord(form.table.organization_id, form.table.id, coerced, {
    type: 'api',
    id: `form:${slug}`,
  })
  return { record, form }
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
  table: 'engine_bases' | 'engine_tables' | 'engine_fields' | 'engine_records' | 'engine_views',
  scopeCol: 'organization_id' | 'table_id',
  scopeVal: string,
): Promise<number> {
  const row = await queryOne<{ max: number | null }>(
    `select max(position) as max from public.${table} where ${scopeCol} = $1`,
    [scopeVal],
  )
  return (row?.max ?? -1) + 1
}
