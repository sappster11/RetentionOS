// Relations & computed fields — the read-side of Phase B. Given a set of records and the
// table's field definitions, this module computes the `display` sibling map (linked-record
// labels, lookups, rollups) using BATCHED queries: at most one links query per linked_record
// field and one target-record fetch per linked table, never per-record (no N+1).
//
// The write-side (syncing engine_record_links inside a mutation transaction) lives here too
// so engine.ts's create/updateRecord stay readable.

import { query } from '@retentionos/db'
import { evaluateFormula, parseFormula } from './formula'
import { matchesLinkFilters } from './linkFilters'
import { EngineError, isComputedType } from './types'
import type {
  Attachment,
  EngineField,
  EngineRecord,
  EnrichedRecord,
  LinkedRecordRef,
  LinkFilterCondition,
  RecordDisplay,
  RollupAggregate,
} from './types'

interface LinkEdge {
  field_id: string
  from_record_id: string
  to_record_id: string
  position: number
}

/**
 * A linked_record pair shares ONE set of edges. To keep both directions consistent no matter
 * which side is edited, every edge is stored under the pair's OWNER field (the lexicographically
 * smaller of the two field ids) in the owner's direction. This returns, for a given field,
 * which field id the edges live under and whether THIS field reads them forward (owner: from→to)
 * or reversed (inverse: to→from).
 */
function edgeOrientation(field: EngineField): { edgeFieldId: string; reversed: boolean } {
  const inverseId = field.options.inverseFieldId
  if (!inverseId) return { edgeFieldId: field.id, reversed: false } // self-inverse fallback
  const owner = field.id < inverseId ? field.id : inverseId
  return { edgeFieldId: owner, reversed: owner !== field.id }
}

/** The primary (label) field of a table = first field by position. Mirrors the grid's rule. */
function primaryFieldId(fields: EngineField[]): string | undefined {
  return fields[0]?.id
}

function labelFor(record: { values: Record<string, unknown> }, labelFieldId: string | undefined): string {
  if (!labelFieldId) return 'Untitled'
  const v = record.values[labelFieldId]
  if (v == null || v === '') return 'Untitled'
  if (Array.isArray(v)) return v.length ? String(v[0]) : 'Untitled'
  return String(v)
}

/**
 * For each linked_record field on the source table, resolve the ordered target ids for every
 * source record, in ONE query per orientation-batch. Returns a map keyed `${fieldId}:${recordId}`
 * -> ordered target ids. Edges are canonically stored under the pair's owner field, so an
 * inverse field reads the same rows from the reversed end.
 */
async function loadLinksForFields(
  linkFields: EngineField[],
  recordIds: string[],
): Promise<Map<string, string[]>> {
  const grouped = new Map<string, string[]>()
  if (linkFields.length === 0 || recordIds.length === 0) return grouped

  // Map each stored-edge field id back to the reading field(s) + orientation.
  const readers = linkFields.map((f) => ({ field: f, ...edgeOrientation(f) }))
  const edgeFieldIds = [...new Set(readers.map((r) => r.edgeFieldId))]

  const edges = await query<LinkEdge>(
    `select field_id, from_record_id, to_record_id, position
     from public.engine_record_links
     where field_id = any($1::uuid[])
     order by position asc, created_at asc`,
    [edgeFieldIds],
  )

  for (const r of readers) {
    const relevant = edges.filter((e) => e.field_id === r.edgeFieldId)
    for (const rid of recordIds) {
      const list = relevant
        .filter((e) => (r.reversed ? e.to_record_id === rid : e.from_record_id === rid))
        .map((e) => (r.reversed ? e.from_record_id : e.to_record_id))
      if (list.length) grouped.set(`${r.field.id}:${rid}`, list)
    }
  }
  return grouped
}

/**
 * Enrich a batch of records from ONE table with their `display` map. Batched: collects every
 * linked table's needed target records into a single query per table.
 *
 * @param orgId  tenant scope (target records must be same-org)
 * @param fields the source table's field definitions
 * @param records the raw records to enrich
 */
export async function enrichRecords(
  orgId: string,
  fields: EngineField[],
  records: EngineRecord[],
): Promise<EnrichedRecord[]> {
  if (records.length === 0) return []

  const byId = new Map(fields.map((f) => [f.id, f]))
  const recordIds = records.map((r) => r.id)

  // The linked_record fields on this table (source of links + basis for lookups/rollups).
  const linkFields = fields.filter((f) => f.type === 'linked_record')

  // 1. Resolve, per link field, each record's ordered target ids (orientation-aware).
  const linksByKey = await loadLinksForFields(linkFields, recordIds)

  // 2. Gather all target record ids we need to resolve, grouped by their table, so each
  //    linked table is fetched exactly once. lookup/rollup(non-count) also need target values.
  const targetsByTable = new Map<string, Set<string>>()
  function needTargets(tableId: string, ids: string[]) {
    const set = targetsByTable.get(tableId) ?? new Set<string>()
    for (const id of ids) set.add(id)
    targetsByTable.set(tableId, set)
  }
  for (const lf of linkFields) {
    const targetTableId = lf.options.linkedTableId
    if (!targetTableId) continue
    for (const rid of recordIds) {
      const ids = linksByKey.get(`${lf.id}:${rid}`) ?? []
      if (ids.length) needTargets(targetTableId, ids)
    }
  }

  // 3. Fetch target records (id, values) per linked table in one query each, plus that
  //    table's fields (for the primary-label rule and lookup/rollup target coercion).
  interface TargetRow { id: string; table_id: string; values: Record<string, unknown> }
  const targetRecById = new Map<string, TargetRow>()
  const fieldsByTable = new Map<string, EngineField[]>()
  for (const [tableId, idSet] of targetsByTable) {
    const ids = [...idSet]
    const rows = await query<TargetRow>(
      `select id, table_id, values from public.engine_records
       where organization_id = $1 and table_id = $2 and id = any($3::uuid[])`,
      [orgId, tableId, ids],
    )
    for (const row of rows) targetRecById.set(row.id, row)
    const tfields = await query<EngineField>(
      `select id, table_id, name, type, options, position, required,
              created_by_type, created_by_id, created_at, updated_at
       from public.engine_fields where table_id = $1 order by position asc, created_at asc`,
      [tableId],
    )
    fieldsByTable.set(tableId, tfields)
  }

  // 4. Build each record's display map.
  return records.map((rec) => {
    const display: RecordDisplay = {}
    const values = { ...rec.values }

    for (const f of fields) {
      if (f.type === 'linked_record') {
        const ids = linksByKey.get(`${f.id}:${rec.id}`) ?? []
        const labelFieldId = primaryFieldId(fieldsByTable.get(f.options.linkedTableId ?? '') ?? [])
        // values holds the raw id array (links table is the source of truth, projected here).
        values[f.id] = ids
        display[f.id] = ids.map<LinkedRecordRef>((id) => {
          const t = targetRecById.get(id)
          return { id, label: t ? labelFor(t, labelFieldId) : 'Unknown' }
        })
      } else if (f.type === 'lookup') {
        const linkField = f.options.recordLinkFieldId ? byId.get(f.options.recordLinkFieldId) : undefined
        const targetFields = fieldsByTable.get(linkField?.options.linkedTableId ?? '')
        display[f.id] = computeLookup(f, rec, linkField, targetFields, linksByKey, targetRecById)
      } else if (f.type === 'rollup') {
        const linkField = f.options.recordLinkFieldId ? byId.get(f.options.recordLinkFieldId) : undefined
        const targetFields = fieldsByTable.get(linkField?.options.linkedTableId ?? '')
        display[f.id] = computeRollup(f, rec, linkField, targetFields, linksByKey, targetRecById)
      } else if (f.type === 'formula') {
        display[f.id] = computeFormula(f, rec, byId)
      } else if (f.type === 'attachment') {
        display[f.id] = Array.isArray(rec.values[f.id]) ? (rec.values[f.id] as Attachment[]) : []
      } else if (f.type === 'autonumber') {
        display[f.id] = rec.values[f.id] ?? null
      } else if (f.type === 'created_time') {
        display[f.id] = rec.created_at
      } else if (f.type === 'last_modified_time') {
        display[f.id] = rec.updated_at
      }
    }

    return { ...rec, values, display }
  })
}

interface TargetRowLike { id: string; values: Record<string, unknown> }

/**
 * Is the lookup/rollup still wired to fields that exist? A field can be deleted out from
 * under a computed field (recordLinkFieldId or targetFieldId gone). When that happens we
 * compute as if the link set were empty (null / empty-set per aggregate) rather than reading
 * stale values. `targetFields` is the linked table's CURRENT field set (undefined = not
 * loaded because there were no links, which already yields empty-set semantics).
 */
function targetFieldMissing(
  linkField: EngineField | undefined,
  targetFieldId: string | undefined,
  targetFields: EngineField[] | undefined,
): boolean {
  // recordLinkFieldId no longer resolves to a linked_record field on this table.
  if (!linkField || linkField.type !== 'linked_record') return true
  // A concrete targetFieldId that's no longer present in the linked table's fields.
  if (targetFieldId && targetFields && !targetFields.some((tf) => tf.id === targetFieldId)) {
    return true
  }
  return false
}

/**
 * Stale-FILTER safety, same pattern as targetFieldMissing: if any filters[].fieldId no
 * longer exists on the linked table, the lookup/rollup computes as empty — never a crash,
 * never stale data. `targetFields` undefined means no linked rows were loaded, which is
 * empty-set semantics anyway.
 */
function filterFieldMissing(
  filters: LinkFilterCondition[] | undefined,
  targetFields: EngineField[] | undefined,
): boolean {
  if (!filters || filters.length === 0) return false
  if (!targetFields) return true
  return filters.some((c) => !targetFields.some((tf) => tf.id === c.fieldId))
}

/** Round to a field's configured precision (currency defaults to 2; otherwise no rounding). */
function roundToPrecision(v: number, field: EngineField): number {
  let p = field.options.precision
  if (p === undefined && field.type === 'currency') p = 2
  if (p === undefined) return v
  const f = 10 ** p
  return Math.round(v * f) / f
}

/**
 * Resolve one record's linked rows (in link order) for a lookup/rollup, applying the
 * field's optional AND-ed `filters` in this same in-memory pass — the target rows were
 * already batch-fetched (one query per linked table), so filtering adds no queries.
 */
function collectLinkedRows(
  linkFieldId: string | undefined,
  rec: EngineRecord,
  linksByKey: Map<string, string[]>,
  targetRecById: Map<string, TargetRowLike>,
  filters: LinkFilterCondition[] | undefined,
  targetFields: EngineField[] | undefined,
): TargetRowLike[] {
  if (!linkFieldId) return []
  const ids = linksByKey.get(`${linkFieldId}:${rec.id}`) ?? []
  const rows: TargetRowLike[] = []
  for (const id of ids) {
    const t = targetRecById.get(id)
    if (t) rows.push(t)
  }
  if (!filters || filters.length === 0) return rows
  const fieldsById = new Map((targetFields ?? []).map((f) => [f.id, f]))
  return rows.filter((r) => matchesLinkFilters(r.values, filters, fieldsById))
}

function computeLookup(
  field: EngineField,
  rec: EngineRecord,
  linkField: EngineField | undefined,
  targetFields: EngineField[] | undefined,
  linksByKey: Map<string, string[]>,
  targetRecById: Map<string, TargetRowLike>,
): unknown[] {
  // If the link, target, or any filter field was deleted, the lookup reads as empty
  // rather than stale.
  if (targetFieldMissing(linkField, field.options.targetFieldId, targetFields)) return []
  if (filterFieldMissing(field.options.filters, targetFields)) return []
  const targetFieldId = field.options.targetFieldId
  const rows = collectLinkedRows(
    field.options.recordLinkFieldId,
    rec,
    linksByKey,
    targetRecById,
    field.options.filters,
    targetFields,
  )
  return rows.map((r) => (targetFieldId ? r.values[targetFieldId] ?? null : null))
}

function computeRollup(
  field: EngineField,
  rec: EngineRecord,
  linkField: EngineField | undefined,
  targetFields: EngineField[] | undefined,
  linksByKey: Map<string, string[]>,
  targetRecById: Map<string, TargetRowLike>,
): number | string | null {
  const aggregate = (field.options.aggregate ?? 'count') as RollupAggregate
  const linkFieldId = field.options.recordLinkFieldId
  const filters = field.options.filters
  // count only needs the link field; non-count also needs the target field to still exist.
  // A stale filter field (deleted on the linked table) makes EVERY aggregate compute as
  // empty — 0 for count/sum, null for avg/min/max — never stale data.
  const missing =
    (aggregate === 'count'
      ? !linkField || linkField.type !== 'linked_record'
      : targetFieldMissing(linkField, field.options.targetFieldId, targetFields)) ||
    filterFieldMissing(filters, targetFields)
  const rows = missing
    ? []
    : collectLinkedRows(linkFieldId, rec, linksByKey, targetRecById, filters, targetFields)
  if (aggregate === 'count') return rows.length

  const targetFieldId = field.options.targetFieldId
  const raw = rows.map((r) => (targetFieldId ? r.values[targetFieldId] ?? null : null))
  const present = raw.filter((v) => v !== null && v !== undefined && v !== '')

  if (aggregate === 'concat') {
    return present.map((v) => String(v)).join(', ')
  }
  const targetField = targetFields?.find((tf) => tf.id === targetFieldId)
  // Date/datetime min/max: ISO strings order lexicographically ≡ chronologically, so compare
  // as strings and return the winning ISO string untouched — never through the numeric path.
  if (
    (aggregate === 'min' || aggregate === 'max') &&
    (targetField?.type === 'date' || targetField?.type === 'datetime')
  ) {
    const strs = present.map((v) => String(v))
    if (strs.length === 0) return null
    return strs.reduce((a, b) => (aggregate === 'min' ? (b < a ? b : a) : (b > a ? b : a)))
  }
  // Numeric aggregates: sum/avg/min/max over numeric-coercible values. The result is rounded
  // to the TARGET field's precision (currency defaults to 2) so float drift (0.1+0.2) is
  // clean. Precision rounding applies ONLY to numeric target types.
  const numericTarget =
    targetField &&
    (targetField.type === 'number' || targetField.type === 'currency' || targetField.type === 'percent')
  const round = (v: number) => (numericTarget ? roundToPrecision(v, targetField) : v)
  const nums = present.map((v) => Number(v)).filter((n) => !Number.isNaN(n))
  if (aggregate === 'sum') return round(nums.reduce((a, b) => a + b, 0))
  if (nums.length === 0) return null // avg/min/max over an empty set → null
  if (aggregate === 'avg') return round(nums.reduce((a, b) => a + b, 0) / nums.length)
  if (aggregate === 'min') return round(Math.min(...nums))
  if (aggregate === 'max') return round(Math.max(...nums))
  return null
}

/**
 * Compute a formula field for one record. Arithmetic over this record's own number/currency/
 * percent fields. A referenced field that's been deleted or is no longer numeric makes the
 * result null (same "compute as empty, not stale" rule as lookups/rollups). A malformed stored
 * expression (shouldn't happen — validated on write) also yields null rather than throwing.
 */
function computeFormula(
  field: EngineField,
  rec: EngineRecord,
  byId: Map<string, EngineField>,
): number | null {
  const expression = field.options.expression
  if (!expression) return null
  let ast
  try {
    ast = parseFormula(expression)
  } catch {
    return null
  }
  // Build the value map, coercing each referenced field's stored value. A ref that's gone or
  // non-numeric is left absent so evaluateFormula sees null and propagates it.
  const values: Record<string, unknown> = {}
  for (const [id, raw] of Object.entries(rec.values)) {
    const ref = byId.get(id)
    if (ref && (ref.type === 'number' || ref.type === 'currency' || ref.type === 'percent')) {
      values[id] = raw
    }
  }
  return evaluateFormula(ast, values)
}

// ---------------------------------------------------------------------------
// Write-side: sync engine_record_links for one record's linked_record fields, inside the
// caller's transaction. `linkValues` maps fieldId -> ordered target record id array.
// ---------------------------------------------------------------------------

interface TxClient {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number | null }>
}

/**
 * Validate that every target id exists in the field's linked table (same org), then replace
 * that field's edges for this from-record. Returns the old id array (for revision diffs).
 */
export async function syncLinksForField(
  client: TxClient,
  orgId: string,
  field: EngineField,
  fromRecordId: string,
  targetIds: string[],
): Promise<string[]> {
  const linkedTableId = field.options.linkedTableId
  if (!linkedTableId) throw new EngineError(`Linked field "${field.name}" is misconfigured.`, 'bad_options')

  // Existence + same-org + same-linked-table check for all targets in one query.
  if (targetIds.length > 0) {
    const found = await client.query(
      `select id from public.engine_records
       where organization_id = $1 and table_id = $2 and id = any($3::uuid[])`,
      [orgId, linkedTableId, targetIds],
    )
    const foundIds = new Set((found.rows as { id: string }[]).map((r) => r.id))
    for (const id of targetIds) {
      if (!foundIds.has(id)) {
        throw new EngineError(
          `Linked field "${field.name}": record "${id}" is not in the linked table (or not in this org).`,
          'bad_value',
        )
      }
    }
  }

  // Edges are stored canonically under the pair's OWNER field. This field reads/writes them
  // forward (owner) or reversed (inverse). Writing from the inverse side swaps from/to so the
  // owner's edges stay the single source of truth for both directions.
  const { edgeFieldId, reversed } = edgeOrientation(field)
  const fromCol = reversed ? 'to_record_id' : 'from_record_id'
  const toCol = reversed ? 'from_record_id' : 'to_record_id'

  // Read existing edges for THIS from-record (for the diff), then replace wholesale.
  const before = await client.query(
    `select ${toCol} as tid from public.engine_record_links
     where field_id = $1 and ${fromCol} = $2 order by position asc`,
    [edgeFieldId, fromRecordId],
  )
  const oldIds = (before.rows as { tid: string }[]).map((r) => r.tid)

  await client.query(
    `delete from public.engine_record_links where field_id = $1 and ${fromCol} = $2`,
    [edgeFieldId, fromRecordId],
  )
  for (let i = 0; i < targetIds.length; i++) {
    await client.query(
      `insert into public.engine_record_links (field_id, ${fromCol}, ${toCol}, position)
       values ($1, $2, $3, $4)
       on conflict (field_id, from_record_id, to_record_id) do nothing`,
      [edgeFieldId, fromRecordId, targetIds[i], i],
    )
  }
  return oldIds
}

export { isComputedType }
