// Client-safe field-type helpers. These MUST stay free of any import from the
// @retentionos/engine barrel, whose index pulls in the server-only `pg` driver (via the
// engine service layer) and would break the client bundle. The values here mirror the
// engine's COMPUTED_FIELD_TYPES / isComputedType exactly.
import type { FieldType } from '@retentionos/engine'

export const COMPUTED_FIELD_TYPES: readonly FieldType[] = [
  'lookup',
  'rollup',
  'formula',
  'autonumber',
  'created_time',
  'last_modified_time',
]

export function isComputedType(t: FieldType): boolean {
  return COMPUTED_FIELD_TYPES.includes(t)
}

/** Mirrors the engine's isFormWritableType: what a public form may write (v1: no
 * computed fields, no linked_record — forms must not expose record search). */
export function isFormWritableType(t: FieldType): boolean {
  return !isComputedType(t) && t !== 'linked_record'
}
