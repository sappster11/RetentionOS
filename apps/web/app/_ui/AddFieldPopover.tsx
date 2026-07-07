'use client'

import { useEffect, useMemo, useState } from 'react'
import type {
  EngineField,
  EngineTable,
  FieldOptions,
  FieldType,
  LinkFilterCondition,
  LinkFilterOp,
  SelectChoice,
} from '@retentionos/engine'
import { COMPUTED_FIELD_TYPES } from './fieldMeta'
import { api } from './apiClient'
import { buttonGhost, buttonPrimary, inputStyle } from './primitives'
import { CHOICE_COLORS } from './Cell'

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Text',
  long_text: 'Long text',
  single_select: 'Single select',
  multi_select: 'Multi select',
  number: 'Number',
  currency: 'Currency',
  percent: 'Percent',
  checkbox: 'Checkbox',
  date: 'Date',
  datetime: 'Date & time',
  url: 'URL',
  email: 'Email',
  attachment: 'Attachment',
  linked_record: 'Link to another record',
  lookup: 'Lookup',
  rollup: 'Rollup',
  formula: 'Formula',
  autonumber: 'Autonumber',
  created_time: 'Created time',
  last_modified_time: 'Last modified time',
}

const TYPES = Object.keys(FIELD_TYPE_LABELS) as FieldType[]

const ROLLUP_AGGREGATES: { value: string; label: string }[] = [
  { value: 'count', label: 'Count' },
  { value: 'sum', label: 'Sum' },
  { value: 'avg', label: 'Average' },
  { value: 'min', label: 'Min' },
  { value: 'max', label: 'Max' },
  { value: 'concat', label: 'Concatenate' },
]
const COLOR_NAMES = Object.keys(CHOICE_COLORS)

// Lookup/rollup "Only include records where…" condition operators (the engine's
// LINK_FILTER_OPS vocabulary, labeled for humans). Relative-date ops apply to
// date/datetime fields only and are evaluated at read time (never frozen).
const FILTER_OPS: { value: LinkFilterOp; label: string; dateOnly?: boolean }[] = [
  { value: 'eq', label: 'is' },
  { value: 'neq', label: 'is not' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
  { value: 'on_or_before_today', label: 'is on or before today', dateOnly: true },
  { value: 'on_or_after_today', label: 'is on or after today', dateOnly: true },
]

/** The condition ops valid for a given linked-table field. */
function filterOpsForField(field: EngineField | undefined) {
  const isDate = field?.type === 'date' || field?.type === 'datetime'
  return FILTER_OPS.filter((o) => !o.dateOnly || isDate)
}

interface FilterRow {
  fieldId: string
  op: LinkFilterOp
  value: string
}

let choiceSeq = 0
function newChoiceId() {
  choiceSeq += 1
  return `ch_${Date.now().toString(36)}_${choiceSeq}`
}

export function AddFieldPopover({
  onClose,
  onCreate,
  tableId,
  fields,
}: {
  onClose: () => void
  onCreate: (input: { name: string; type: FieldType; options?: FieldOptions; required?: boolean }) => Promise<void>
  tableId: string
  fields: EngineField[]
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState<FieldType>('text')
  const [required, setRequired] = useState(false)
  const [choices, setChoices] = useState<SelectChoice[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Relation/computed option state.
  const [linkedTableId, setLinkedTableId] = useState('')
  const [recordLinkFieldId, setRecordLinkFieldId] = useState('')
  const [targetFieldId, setTargetFieldId] = useState('')
  const [aggregate, setAggregate] = useState('count')
  const [filters, setFilters] = useState<FilterRow[]>([])
  const [tables, setTables] = useState<EngineTable[]>([])
  const [targetFields, setTargetFields] = useState<EngineField[]>([])
  const [expression, setExpression] = useState('')
  const [insertFieldId, setInsertFieldId] = useState('')

  const isSelect = type === 'single_select' || type === 'multi_select'
  const isLinked = type === 'linked_record'
  const isLookup = type === 'lookup'
  const isRollup = type === 'rollup'
  const isFormula = type === 'formula'
  const needsTables = isLinked
  const needsLinkPicker = isLookup || isRollup

  // linked_record fields already on THIS table (the basis for lookup/rollup).
  const linkFields = useMemo(() => fields.filter((f) => f.type === 'linked_record'), [fields])
  // Numeric fields on THIS table a formula may reference (number/currency/percent).
  const numericFields = useMemo(
    () => fields.filter((f) => f.type === 'number' || f.type === 'currency' || f.type === 'percent'),
    [fields],
  )
  const fieldNameById = useMemo(() => new Map(fields.map((f) => [f.id, f.name])), [fields])
  // Linked-table fields a lookup/rollup filter may condition on: concrete only (the
  // engine rejects computed, linked_record, and — until array-membership semantics
  // land — multi_select filter fields).
  const filterableFields = useMemo(
    () =>
      targetFields.filter(
        (f) =>
          !COMPUTED_FIELD_TYPES.includes(f.type) &&
          f.type !== 'linked_record' &&
          f.type !== 'multi_select',
      ),
    [targetFields],
  )

  // Render {fld:ID} tokens as {fld:Name} for the textarea; stored value stays canonical (IDs).
  function displayExpression(expr: string): string {
    return expr.replace(/\{fld:([^}]+)\}/g, (_, id) => `{fld:${fieldNameById.get(id.trim()) ?? id}}`)
  }
  function insertToken(id: string) {
    if (!id) return
    setExpression((e) => `${e}{fld:${id}}`)
    setInsertFieldId('')
  }

  // Load table list once (for the linked_record target picker).
  useEffect(() => {
    if (!needsTables || tables.length) return
    api.listTables().then(setTables).catch(() => setTables([]))
  }, [needsTables, tables.length])

  // When a link field is chosen for lookup/rollup, load the target table's targetable
  // fields: concrete ones, plus LOOKUPS (depth-2 chaining — the engine validates that a
  // chained lookup's own target resolves concrete and rejects deeper chains).
  useEffect(() => {
    if (!needsLinkPicker || !recordLinkFieldId) {
      setTargetFields([])
      return
    }
    const lf = linkFields.find((f) => f.id === recordLinkFieldId)
    const targetTableId = lf?.options.linkedTableId
    if (!targetTableId) return
    api
      .describeTable(targetTableId)
      .then((d) =>
        setTargetFields(
          d.fields.filter((f) => !COMPUTED_FIELD_TYPES.includes(f.type) || f.type === 'lookup'),
        ),
      )
      .catch(() => setTargetFields([]))
  }, [needsLinkPicker, recordLinkFieldId, linkFields])

  function buildFilters(): LinkFilterCondition[] | undefined {
    const rows = filters.filter((r) => r.fieldId)
    if (rows.length === 0) return undefined
    return rows.map((r) => ({
      fieldId: r.fieldId,
      op: r.op,
      ...(r.op === 'eq' || r.op === 'neq' ? { value: r.value } : {}),
    }))
  }

  function buildOptions(): FieldOptions | undefined {
    if (isSelect) return { choices: choices.filter((c) => c.name.trim()) }
    if (isLinked) return { linkedTableId }
    const linkFilters = needsLinkPicker ? buildFilters() : undefined
    if (isLookup) return { recordLinkFieldId, targetFieldId, ...(linkFilters ? { filters: linkFilters } : {}) }
    if (isRollup)
      return {
        recordLinkFieldId,
        aggregate: aggregate as FieldOptions['aggregate'],
        ...(aggregate === 'count' && !targetFieldId ? {} : { targetFieldId }),
        ...(linkFilters ? { filters: linkFilters } : {}),
      }
    if (isFormula) return { expression: expression.trim() }
    return undefined
  }

  function canSubmit(): boolean {
    if (!name.trim()) return false
    if (isLinked) return !!linkedTableId
    if (isLookup) return !!recordLinkFieldId && !!targetFieldId
    if (isRollup) return !!recordLinkFieldId && (aggregate === 'count' || !!targetFieldId)
    if (isFormula) return !!expression.trim()
    return true
  }

  async function submit() {
    if (!canSubmit()) return
    setBusy(true)
    setError(null)
    try {
      await onCreate({ name: name.trim(), type, required, options: buildOptions() })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add field.')
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 34,
        right: 0,
        zIndex: 30,
        width: 280,
        background: 'var(--bg)',
        border: '1px solid var(--border-strong)',
        borderRadius: 8,
        boxShadow: '0 10px 30px rgba(0,0,0,0.16)',
        padding: 14,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Field name"
          style={inputStyle}
        />
        <select value={type} onChange={(e) => setType(e.target.value as FieldType)} style={inputStyle}>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {FIELD_TYPE_LABELS[t]}
            </option>
          ))}
        </select>

        {isSelect ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Choices</span>
            {choices.map((c, i) => (
              <div key={c.id} style={{ display: 'flex', gap: 4 }}>
                <input
                  value={c.name}
                  onChange={(e) =>
                    setChoices((cs) => cs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                  }
                  placeholder="Choice"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <select
                  value={c.color}
                  onChange={(e) =>
                    setChoices((cs) => cs.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))
                  }
                  style={{ ...inputStyle, width: 88 }}
                >
                  {COLOR_NAMES.map((cn) => (
                    <option key={cn} value={cn}>
                      {cn}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <button
              onClick={() => setChoices((cs) => [...cs, { id: newChoiceId(), name: '', color: 'gray' }])}
              style={{ ...buttonGhost, padding: '4px 8px', fontSize: 12 }}
            >
              + Add choice
            </button>
          </div>
        ) : null}

        {isLinked ? (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
            Linked table
            <select value={linkedTableId} onChange={(e) => setLinkedTableId(e.target.value)} style={inputStyle}>
              <option value="">— pick a table —</option>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.id === tableId ? ' (this table)' : ''}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {needsLinkPicker ? (
          <>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
              Through link field
              {linkFields.length === 0 ? (
                <span style={{ color: 'var(--danger)', fontSize: 11 }}>
                  Add a “Link to another record” field first.
                </span>
              ) : (
                <select
                  value={recordLinkFieldId}
                  onChange={(e) => {
                    setRecordLinkFieldId(e.target.value)
                    setTargetFieldId('')
                    setFilters([]) // conditions belong to the previous linked table
                  }}
                  style={inputStyle}
                >
                  <option value="">— pick a link field —</option>
                  {linkFields.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              )}
            </label>
            {isRollup ? (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                Aggregate
                <select value={aggregate} onChange={(e) => setAggregate(e.target.value)} style={inputStyle}>
                  {ROLLUP_AGGREGATES.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {recordLinkFieldId && !(isRollup && aggregate === 'count') ? (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                {isRollup ? 'Field to aggregate' : 'Field to look up'}
                <select value={targetFieldId} onChange={(e) => setTargetFieldId(e.target.value)} style={inputStyle}>
                  <option value="">— pick a field —</option>
                  {targetFields.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {recordLinkFieldId && filterableFields.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Only include records where…
                </span>
                {filters.map((row, i) => {
                  const needsValue = row.op === 'eq' || row.op === 'neq'
                  const rowField = filterableFields.find((f) => f.id === row.fieldId)
                  const rowOps = filterOpsForField(rowField)
                  return (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <select
                          value={row.fieldId}
                          onChange={(e) => {
                            const fieldId = e.target.value
                            const next = filterableFields.find((f) => f.id === fieldId)
                            // A relative-date op can't survive a switch to a non-date field.
                            const opStillValid = filterOpsForField(next).some((o) => o.value === row.op)
                            setFilters((fs) =>
                              fs.map((x, j) =>
                                j === i
                                  ? { ...x, fieldId, ...(opStillValid ? {} : { op: 'eq' as LinkFilterOp, value: '' }) }
                                  : x,
                              ),
                            )
                          }}
                          style={{ ...inputStyle, flex: 1, minWidth: 0 }}
                        >
                          <option value="">— field —</option>
                          {filterableFields.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                        <select
                          value={row.op}
                          onChange={(e) =>
                            setFilters((fs) =>
                              fs.map((x, j) => (j === i ? { ...x, op: e.target.value as LinkFilterOp } : x)),
                            )
                          }
                          style={{ ...inputStyle, width: 104 }}
                        >
                          {rowOps.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => setFilters((fs) => fs.filter((_, j) => j !== i))}
                          title="Remove condition"
                          style={{ ...buttonGhost, padding: '2px 7px' }}
                        >
                          ×
                        </button>
                      </div>
                      {needsValue
                        ? (() => {
                            const setValue = (v: string) =>
                              setFilters((fs) => fs.map((x, j) => (j === i ? { ...x, value: v } : x)))
                            const ff = filterableFields.find((f) => f.id === row.fieldId)
                            // Selects store choice IDS — offer the choices, not a free-text box.
                            if (ff && (ff.type === 'single_select' || ff.type === 'multi_select')) {
                              return (
                                <select value={row.value} onChange={(e) => setValue(e.target.value)} style={inputStyle}>
                                  <option value="">— pick a choice —</option>
                                  {(ff.options.choices ?? []).map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.name}
                                    </option>
                                  ))}
                                </select>
                              )
                            }
                            if (ff?.type === 'checkbox') {
                              // "checked" is eq 'true'; "unchecked" is neq 'true'
                              // (is-distinct-from) so it matches rows where the box is
                              // false AND rows where it was never set — what users mean.
                              const cbState =
                                row.value !== 'true' ? '' : row.op === 'neq' ? 'unchecked' : 'checked'
                              return (
                                <select
                                  value={cbState}
                                  onChange={(e) => {
                                    const v = e.target.value
                                    setFilters((fs) =>
                                      fs.map((x, j) =>
                                        j === i
                                          ? {
                                              ...x,
                                              op: v === 'unchecked' ? 'neq' : 'eq',
                                              value: v ? 'true' : '',
                                            }
                                          : x,
                                      ),
                                    )
                                  }}
                                  style={inputStyle}
                                >
                                  <option value="">— pick —</option>
                                  <option value="checked">checked</option>
                                  <option value="unchecked">unchecked</option>
                                </select>
                              )
                            }
                            return (
                              <input
                                value={row.value}
                                onChange={(e) => setValue(e.target.value)}
                                placeholder="Value"
                                style={inputStyle}
                              />
                            )
                          })()
                        : null}
                    </div>
                  )
                })}
                <button
                  onClick={() => setFilters((fs) => [...fs, { fieldId: '', op: 'eq', value: '' }])}
                  style={{ ...buttonGhost, padding: '4px 8px', fontSize: 12, alignSelf: 'flex-start' }}
                >
                  + Add condition
                </button>
              </div>
            ) : null}
          </>
        ) : null}

        {isFormula ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
              Expression
              <textarea
                value={expression}
                onChange={(e) => setExpression(e.target.value)}
                placeholder="{fld:…} * 0.5 + 2"
                rows={3}
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
              Insert field
              {numericFields.length === 0 ? (
                <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>
                  Add a number, currency, or percent field first.
                </span>
              ) : (
                <select
                  value={insertFieldId}
                  onChange={(e) => insertToken(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">— insert a field —</option>
                  {numericFields.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              )}
            </label>
            {expression.trim() ? (
              <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: 0, wordBreak: 'break-word' }}>
                {displayExpression(expression)}
              </p>
            ) : null}
            <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: 0 }}>
              Arithmetic (+ − × ÷, parentheses) over number/currency/percent fields. Read-only.
            </p>
          </div>
        ) : null}

        {COMPUTED_FIELD_TYPES.includes(type) && !isFormula ? (
          <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: 0 }}>
            This is a computed, read-only field.
          </p>
        ) : COMPUTED_FIELD_TYPES.includes(type) ? null : (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
            Required
          </label>
        )}

        {error ? <p style={{ color: 'var(--danger)', fontSize: 12, margin: 0 }}>{error}</p> : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <button onClick={onClose} style={{ ...buttonGhost, padding: '5px 10px' }}>
            Cancel
          </button>
          <button onClick={submit} disabled={busy || !canSubmit()} style={{ ...buttonPrimary, padding: '5px 10px' }}>
            {busy ? 'Adding…' : 'Add field'}
          </button>
        </div>
      </div>
    </div>
  )
}

export { FIELD_TYPE_LABELS }
