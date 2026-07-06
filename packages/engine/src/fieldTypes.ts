// Per-field-type validation & coercion. This is the heart of the engine's data
// integrity: given a field definition and an incoming raw value, produce the canonical
// stored value or throw an EngineError the caller can surface. Every write path
// (createRecord/updateRecord, UI, API, future MCP) goes through here — there is no
// second, looser validator anywhere.

import { parseFormula } from './formula'
import { EngineError, FIELD_TYPES, isComputedType } from './types'
import type { Attachment, EngineField, FieldOptions, FieldType, SelectChoice } from './types'

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function isFieldType(t: string): t is FieldType {
  return (FIELD_TYPES as readonly string[]).includes(t)
}

/** Validate a field's options block at field-create/update time (choice ids unique, etc.). */
export function validateFieldOptions(type: FieldType, options: FieldOptions | undefined): FieldOptions {
  const opts = options ?? {}
  if (type === 'single_select' || type === 'multi_select') {
    const choices = opts.choices ?? []
    if (!Array.isArray(choices)) {
      throw new EngineError(`Field of type ${type} requires options.choices to be an array.`, 'bad_options')
    }
    const seen = new Set<string>()
    for (const c of choices) {
      if (!isPlainObject(c) || typeof c.id !== 'string' || typeof c.name !== 'string') {
        throw new EngineError('Each select choice needs a string id and name.', 'bad_options')
      }
      if (seen.has(c.id)) {
        throw new EngineError(`Duplicate select choice id "${c.id}".`, 'bad_options')
      }
      seen.add(c.id)
    }
    return {
      ...opts,
      choices: choices.map((c) => ({
        id: c.id,
        name: c.name,
        color: typeof c.color === 'string' && c.color ? c.color : 'gray',
      })) as SelectChoice[],
    }
  }
  if (type === 'linked_record') {
    if (typeof opts.linkedTableId !== 'string' || !opts.linkedTableId) {
      throw new EngineError('A linked record field requires options.linkedTableId.', 'bad_options')
    }
    // inverseFieldId is filled in by the engine when it creates the paired inverse field.
    return opts
  }
  if (type === 'lookup') {
    if (typeof opts.recordLinkFieldId !== 'string' || !opts.recordLinkFieldId) {
      throw new EngineError('A lookup field requires options.recordLinkFieldId.', 'bad_options')
    }
    if (typeof opts.targetFieldId !== 'string' || !opts.targetFieldId) {
      throw new EngineError('A lookup field requires options.targetFieldId.', 'bad_options')
    }
    return opts
  }
  if (type === 'rollup') {
    if (typeof opts.recordLinkFieldId !== 'string' || !opts.recordLinkFieldId) {
      throw new EngineError('A rollup field requires options.recordLinkFieldId.', 'bad_options')
    }
    const AGGS = ['count', 'sum', 'avg', 'min', 'max', 'concat']
    if (typeof opts.aggregate !== 'string' || !AGGS.includes(opts.aggregate)) {
      throw new EngineError(`A rollup field requires options.aggregate to be one of ${AGGS.join(', ')}.`, 'bad_options')
    }
    // targetFieldId is optional only for count.
    if (opts.aggregate !== 'count' && (typeof opts.targetFieldId !== 'string' || !opts.targetFieldId)) {
      throw new EngineError(`A "${opts.aggregate}" rollup requires options.targetFieldId.`, 'bad_options')
    }
    return opts
  }
  if (type === 'formula') {
    // Syntactic check only; the referenced fields' existence + type is verified with a DB
    // round-trip in the engine (assertRelationOptions). parseFormula throws bad_options on
    // any syntax error. The expression is stored verbatim (canonical {fld:ID} tokens).
    parseFormula(opts.expression ?? '')
    return opts
  }
  return opts
}

function choiceIds(field: EngineField): Set<string> {
  return new Set((field.options.choices ?? []).map((c) => c.id))
}

/**
 * Coerce & validate a single raw value for one field. Returns the canonical value to
 * store in engine_records.values, or throws EngineError. `null`/`undefined`/`''`:
 *  - rejected if the field is required
 *  - otherwise stored as null (absent value)
 */
export function coerceValue(field: EngineField, raw: unknown): unknown {
  const empty = raw === null || raw === undefined || raw === ''
  if (empty) {
    if (field.required) {
      throw new EngineError(`Field "${field.name}" is required.`, 'required')
    }
    return null
  }

  switch (field.type) {
    case 'text':
    case 'long_text': {
      if (typeof raw !== 'string') {
        throw new EngineError(`Field "${field.name}" expects text.`, 'bad_value')
      }
      return raw
    }

    case 'url': {
      if (typeof raw !== 'string') {
        throw new EngineError(`Field "${field.name}" expects a URL string.`, 'bad_value')
      }
      try {
        // eslint-disable-next-line no-new
        new URL(raw)
      } catch {
        throw new EngineError(`Field "${field.name}" is not a valid URL: ${raw}`, 'bad_value')
      }
      return raw
    }

    case 'email': {
      if (typeof raw !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
        throw new EngineError(`Field "${field.name}" is not a valid email: ${String(raw)}`, 'bad_value')
      }
      return raw
    }

    case 'number':
    case 'currency': {
      const n = typeof raw === 'string' ? Number(raw) : raw
      if (typeof n !== 'number' || Number.isNaN(n) || !Number.isFinite(n)) {
        throw new EngineError(`Field "${field.name}" expects a number, got: ${String(raw)}`, 'bad_value')
      }
      return n
    }

    case 'percent': {
      // Stored as a fraction (0.5 == 50%). Accept a number, a numeric string, or a
      // "%"-suffixed string ("50%" -> 0.5). No clamping — >1 and negatives are valid.
      let n: number
      if (typeof raw === 'number') {
        n = raw
      } else if (typeof raw === 'string') {
        const trimmed = raw.trim()
        if (trimmed.endsWith('%')) {
          n = Number(trimmed.slice(0, -1).trim()) / 100
        } else {
          n = Number(trimmed)
        }
      } else {
        throw new EngineError(`Field "${field.name}" expects a percent number.`, 'bad_value')
      }
      if (!Number.isFinite(n)) {
        throw new EngineError(`Field "${field.name}" expects a percent number, got: ${String(raw)}`, 'bad_value')
      }
      return n
    }

    case 'checkbox': {
      if (typeof raw === 'boolean') return raw
      if (raw === 'true') return true
      if (raw === 'false') return false
      throw new EngineError(`Field "${field.name}" expects a boolean.`, 'bad_value')
    }

    case 'date': {
      if (typeof raw !== 'string' || !DATE_ONLY_RE.test(raw) || Number.isNaN(Date.parse(raw))) {
        throw new EngineError(
          `Field "${field.name}" expects an ISO date (YYYY-MM-DD), got: ${String(raw)}`,
          'bad_value',
        )
      }
      return raw
    }

    case 'datetime': {
      if (typeof raw !== 'string' || Number.isNaN(Date.parse(raw))) {
        throw new EngineError(
          `Field "${field.name}" expects an ISO datetime, got: ${String(raw)}`,
          'bad_value',
        )
      }
      // Normalize to a canonical ISO string.
      return new Date(raw).toISOString()
    }

    case 'single_select': {
      if (typeof raw !== 'string') {
        throw new EngineError(`Field "${field.name}" expects a choice id.`, 'bad_value')
      }
      if (!choiceIds(field).has(raw)) {
        throw new EngineError(`Field "${field.name}": "${raw}" is not a valid choice id.`, 'bad_value')
      }
      return raw
    }

    case 'multi_select': {
      if (!Array.isArray(raw)) {
        throw new EngineError(`Field "${field.name}" expects an array of choice ids.`, 'bad_value')
      }
      const ids = choiceIds(field)
      for (const v of raw) {
        if (typeof v !== 'string' || !ids.has(v)) {
          throw new EngineError(
            `Field "${field.name}": "${String(v)}" is not a valid choice id.`,
            'bad_value',
          )
        }
      }
      return [...new Set(raw)]
    }

    case 'attachment': {
      if (!Array.isArray(raw)) {
        throw new EngineError(`Field "${field.name}" expects an array of attachments.`, 'bad_value')
      }
      const out: Attachment[] = []
      for (const item of raw) {
        if (!isPlainObject(item) || typeof item.url !== 'string' || !item.url) {
          throw new EngineError(`Field "${field.name}": each attachment needs a url string.`, 'bad_value')
        }
        try {
          // eslint-disable-next-line no-new
          new URL(item.url)
        } catch {
          throw new EngineError(`Field "${field.name}": "${item.url}" is not a valid URL.`, 'bad_value')
        }
        out.push({ url: item.url, ...(typeof item.name === 'string' && item.name ? { name: item.name } : {}) })
      }
      return out
    }

    case 'linked_record': {
      // Value is an array of target record ids. Existence / same-org / same-table checks
      // happen in the engine's write path (needs a DB round-trip); here we only shape it.
      if (!Array.isArray(raw)) {
        throw new EngineError(`Field "${field.name}" expects an array of record ids.`, 'bad_value')
      }
      const ids: string[] = []
      for (const v of raw) {
        if (typeof v !== 'string' || !v) {
          throw new EngineError(`Field "${field.name}": link targets must be record ids.`, 'bad_value')
        }
        if (!ids.includes(v)) ids.push(v)
      }
      return ids
    }

    case 'lookup':
    case 'rollup':
    case 'formula':
    case 'autonumber':
    case 'created_time':
    case 'last_modified_time': {
      // Computed fields are never written directly. `empty` values were already returned
      // as null above, so reaching here means the caller sent a real value — reject it.
      throw new EngineError(
        `Field "${field.name}" is a computed ${field.type} field and cannot be set directly.`,
        'bad_value',
      )
    }

    default: {
      // Exhaustiveness guard — a new FieldType must add a case above.
      const _never: never = field.type
      throw new EngineError(`Unsupported field type: ${String(_never)}`, 'bad_type')
    }
  }
}

/**
 * Coerce a full partial values-patch against the field set. Only keys present in `patch`
 * are processed (so updateRecord can send a subset). Required-field enforcement for
 * MISSING keys is the caller's job on create (see engine.createRecord).
 */
export function coerceValues(
  fields: EngineField[],
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const byId = new Map(fields.map((f) => [f.id, f]))
  const out: Record<string, unknown> = {}
  for (const [fieldId, raw] of Object.entries(patch)) {
    const field = byId.get(fieldId)
    if (!field) {
      throw new EngineError(`Unknown field id "${fieldId}" for this table.`, 'unknown_field')
    }
    if (isComputedType(field.type)) {
      // Computed fields (lookup/rollup/autonumber/created_time/last_modified_time) are
      // read-only — reject any attempt to write them, even null, rather than silently drop.
      throw new EngineError(
        `Field "${field.name}" is a computed ${field.type} field and cannot be set directly.`,
        'bad_value',
      )
    }
    out[fieldId] = coerceValue(field, raw)
  }
  return out
}
