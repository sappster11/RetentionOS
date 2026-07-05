// Engine types — the shared vocabulary for the meta-schema. These mirror the
// migration 0009 tables. `values` on records is keyed by FIELD ID (a uuid string),
// never field name, so renames are free.

/** Human, agent, or programmatic API caller — powers the audit trail's attribution. */
export type ActorType = 'user' | 'agent' | 'api'

/** Who performed a mutation. `id` is optional (e.g. anonymous API key, or a user uuid). */
export interface Actor {
  type: ActorType
  id?: string
}

/** All field types. Phase B adds relations (linked_record), computed (lookup/rollup),
 * attachment, autonumber, and the created/modified time stamps. */
export type FieldType =
  | 'text'
  | 'long_text'
  | 'single_select'
  | 'multi_select'
  | 'number'
  | 'currency'
  | 'checkbox'
  | 'date'
  | 'datetime'
  | 'url'
  | 'email'
  // Phase B
  | 'attachment'
  | 'linked_record'
  | 'lookup'
  | 'rollup'
  | 'autonumber'
  | 'created_time'
  | 'last_modified_time'

export const FIELD_TYPES: readonly FieldType[] = [
  'text',
  'long_text',
  'single_select',
  'multi_select',
  'number',
  'currency',
  'checkbox',
  'date',
  'datetime',
  'url',
  'email',
  'attachment',
  'linked_record',
  'lookup',
  'rollup',
  'autonumber',
  'created_time',
  'last_modified_time',
] as const

/** Field types whose value is derived at read time and can NEVER be written directly. */
export const COMPUTED_FIELD_TYPES: readonly FieldType[] = [
  'lookup',
  'rollup',
  'autonumber',
  'created_time',
  'last_modified_time',
] as const

export function isComputedType(t: FieldType): boolean {
  return (COMPUTED_FIELD_TYPES as readonly string[]).includes(t)
}

/** Rollup aggregate functions. `count` works with targetFieldId omitted. */
export type RollupAggregate = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'concat'

/** A single attachment — URL-based for now (native upload lands with Supabase storage). */
export interface Attachment {
  url: string
  name?: string
}

/** A choice in a single_select / multi_select field, stored in field.options.choices. */
export interface SelectChoice {
  id: string
  name: string
  color: string
}

/** Type-specific field configuration held in engine_fields.options (jsonb). */
export interface FieldOptions {
  choices?: SelectChoice[]
  /** Currency symbol for display, e.g. "$". Advisory only; value is stored as a number. */
  currencySymbol?: string
  /** Number of decimal places for number/currency fields (display hint). */
  precision?: number
  // --- linked_record ---
  /** Target table this linked_record field points at (self-links allowed). */
  linkedTableId?: string
  /** The auto-created inverse linked_record field on the target table. */
  inverseFieldId?: string
  // --- lookup / rollup ---
  /** The linked_record field (on THIS table) whose links the lookup/rollup walks. */
  recordLinkFieldId?: string
  /** The concrete field on the linked table to pull / aggregate (optional for count). */
  targetFieldId?: string
  /** Rollup only: how to aggregate the collected target values. */
  aggregate?: RollupAggregate
}

export type ViewType = 'grid' | 'kanban'

export interface FilterCondition {
  fieldId: string
  op: 'eq' | 'neq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'is_empty' | 'is_not_empty'
  value?: unknown
}

export interface SortSpec {
  fieldId: string
  direction: 'asc' | 'desc'
}

export interface ViewConfig {
  filters?: FilterCondition[]
  sorts?: SortSpec[]
  visibleFieldIds?: string[]
  groupByFieldId?: string | null
}

export interface EngineTable {
  id: string
  organization_id: string
  name: string
  slug: string
  icon: string | null
  description: string | null
  position: number
  created_by_type: ActorType
  created_by_id: string | null
  created_at: string
  updated_at: string
}

export interface EngineField {
  id: string
  table_id: string
  name: string
  type: FieldType
  options: FieldOptions
  position: number
  required: boolean
  created_by_type: ActorType
  created_by_id: string | null
  created_at: string
  updated_at: string
}

/** A record's stored values, keyed by field id. */
export type RecordValues = Record<string, unknown>

export interface EngineRecord {
  id: string
  table_id: string
  organization_id: string
  values: RecordValues
  position: number
  created_by_type: ActorType
  created_by_id: string | null
  created_at: string
  updated_at: string
}

/** A linked record reduced to what the UI needs: its id + primary-field label. */
export interface LinkedRecordRef {
  id: string
  label: string
}

/**
 * The `display` sibling map returned alongside `values`. Computed at read time:
 *  - linked_record → LinkedRecordRef[]  (ids + primary-field labels)
 *  - lookup        → unknown[]          (the pulled target values, one per linked record)
 *  - rollup        → number | string | null  (the aggregate)
 *  - attachment    → passthrough of the stored array (UI convenience)
 *  - autonumber / created_time / last_modified_time → the computed scalar
 * `values` stays RAW (ids / stored scalars only); `display` is never persisted.
 */
export type RecordDisplay = Record<string, unknown>

/** A record enriched for reads: raw `values` plus the computed `display` sibling map. */
export interface EnrichedRecord extends EngineRecord {
  display: RecordDisplay
}

export interface EngineView {
  id: string
  table_id: string
  name: string
  type: ViewType
  config: ViewConfig
  position: number
  created_at: string
  updated_at: string
}

export type RevisionOp = 'create' | 'update' | 'delete'

/** diff maps fieldId -> { from, to }. On create, from is null; on delete, to is null. */
export type RevisionDiff = Record<string, { from: unknown; to: unknown }>

export interface EngineRecordRevision {
  id: string
  record_id: string
  table_id: string
  organization_id: string
  actor_type: ActorType
  actor_id: string | null
  op: RevisionOp
  diff: RevisionDiff
  created_at: string
}

/** A table together with its fields and views — the full schema descriptor. */
export interface TableDescriptor {
  table: EngineTable
  fields: EngineField[]
  views: EngineView[]
}

/** Thrown for any caller-fixable problem (bad field type, missing table, invalid value). */
export class EngineError extends Error {
  constructor(
    message: string,
    readonly code: string = 'engine_error',
  ) {
    super(message)
    this.name = 'EngineError'
  }
}
