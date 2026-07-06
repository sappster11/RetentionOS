// Filtered lookups/rollups — the `filters` clause on lookup/rollup FieldOptions.
// This module owns both halves of the feature's shared logic:
//   - validateLinkFilters: shape-checks an options.filters array at field create/update time
//     (no DB — fieldId existence/concreteness needs a round-trip and lives in the engine's
//     assertRelationOptions, same as the other relation checks).
//   - matchesLinkFilters: the in-memory evaluator applied to already-batch-fetched linked
//     rows during enrichment (links.ts), so the no-N+1 property is untouched.
//
// The operator vocabulary (LINK_FILTER_OPS) is the eq/neq/is_empty/is_not_empty subset of
// the view-filter grammar in queryRecords, with matching semantics:
//   - is_empty      ≙ `path is null or path = ''`
//   - is_not_empty  ≙ `path is not null and path <> ''`
//   - eq            ≙ `lhs = rhs` (a null/absent stored value never matches)
//   - neq           ≙ `lhs is distinct from rhs` (empty values DO match)
// Numeric fields (number/currency/percent) compare numerically — the SQL grammar casts
// both sides to ::numeric — everything else compares as text.

import { EngineError, LINK_FILTER_OPS } from './types'
import type { EngineField, LinkFilterCondition, RecordValues } from './types'

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isLinkFilterOp(op: unknown): op is LinkFilterCondition['op'] {
  return typeof op === 'string' && (LINK_FILTER_OPS as readonly string[]).includes(op)
}

/**
 * Shape-validate a lookup/rollup options.filters value. Returns the canonical array
 * (value present only on eq/neq) or throws EngineError('bad_options').
 */
export function validateLinkFilters(raw: unknown): LinkFilterCondition[] {
  if (!Array.isArray(raw)) {
    throw new EngineError('options.filters must be an array of filter conditions.', 'bad_options')
  }
  const out: LinkFilterCondition[] = []
  for (const c of raw) {
    if (!isPlainObject(c) || typeof c.fieldId !== 'string' || !c.fieldId) {
      throw new EngineError('Each filter condition needs a string fieldId.', 'bad_options')
    }
    if (!isLinkFilterOp(c.op)) {
      throw new EngineError(
        `Filter op must be one of ${LINK_FILTER_OPS.join(', ')}; got "${String(c.op)}".`,
        'bad_options',
      )
    }
    const needsValue = c.op === 'eq' || c.op === 'neq'
    if (needsValue && (c.value === undefined || c.value === null)) {
      throw new EngineError(`Filter op "${c.op}" requires a value.`, 'bad_options')
    }
    if (!needsValue && c.value !== undefined) {
      throw new EngineError(`Filter op "${c.op}" does not take a value.`, 'bad_options')
    }
    out.push({ fieldId: c.fieldId, op: c.op, ...(needsValue ? { value: c.value } : {}) })
  }
  return out
}

/** Mirrors the SQL grammar's emptiness test (`is null or = ''`) on a stored jsonb value. */
function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || v === ''
}

/**
 * Equality matching the view grammar: numeric fields compare as numbers (SQL casts both
 * sides to ::numeric), everything else as text (jsonb `->>` semantics — booleans become
 * 'true'/'false', numbers their decimal form).
 */
function valuesEqual(stored: unknown, filterValue: unknown, numeric: boolean): boolean {
  if (numeric) {
    const a = typeof stored === 'number' ? stored : Number(stored)
    const b = typeof filterValue === 'number' ? filterValue : Number(filterValue)
    return Number.isFinite(a) && Number.isFinite(b) && a === b
  }
  return String(stored) === String(filterValue)
}

/**
 * Evaluate an AND-ed filter set against one linked row's stored values. `fieldsById` is the
 * linked table's CURRENT field map (used to pick numeric vs text comparison). Callers must
 * have already handled stale filters (a fieldId missing from the linked table ⇒ compute as
 * empty, never evaluate) — see links.ts filterFieldMissing.
 */
export function matchesLinkFilters(
  values: RecordValues,
  filters: LinkFilterCondition[],
  fieldsById: Map<string, EngineField>,
): boolean {
  for (const c of filters) {
    const v = values[c.fieldId]
    switch (c.op) {
      case 'is_empty':
        if (!isEmptyValue(v)) return false
        break
      case 'is_not_empty':
        if (isEmptyValue(v)) return false
        break
      case 'eq':
      case 'neq': {
        const f = fieldsById.get(c.fieldId)
        const numeric = f?.type === 'number' || f?.type === 'currency' || f?.type === 'percent'
        // eq: a null/absent stored value never matches (SQL null comparison).
        // neq: is-distinct-from — a null/absent stored value always matches a real rhs.
        const equal = v === null || v === undefined ? false : valuesEqual(v, c.value, numeric)
        if (c.op === 'eq' ? !equal : equal) return false
        break
      }
      default: {
        const _never: never = c.op
        throw new EngineError(`Unsupported filter op "${String(_never)}".`, 'bad_filter')
      }
    }
  }
  return true
}
