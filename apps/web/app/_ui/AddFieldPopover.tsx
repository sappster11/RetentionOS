'use client'

import { useEffect, useMemo, useState } from 'react'
import type { EngineField, EngineTable, FieldOptions, FieldType, SelectChoice } from '@retentionos/engine'
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
  checkbox: 'Checkbox',
  date: 'Date',
  datetime: 'Date & time',
  url: 'URL',
  email: 'Email',
  attachment: 'Attachment',
  linked_record: 'Link to another record',
  lookup: 'Lookup',
  rollup: 'Rollup',
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
  const [tables, setTables] = useState<EngineTable[]>([])
  const [targetFields, setTargetFields] = useState<EngineField[]>([])

  const isSelect = type === 'single_select' || type === 'multi_select'
  const isLinked = type === 'linked_record'
  const isLookup = type === 'lookup'
  const isRollup = type === 'rollup'
  const needsTables = isLinked
  const needsLinkPicker = isLookup || isRollup

  // linked_record fields already on THIS table (the basis for lookup/rollup).
  const linkFields = useMemo(() => fields.filter((f) => f.type === 'linked_record'), [fields])

  // Load table list once (for the linked_record target picker).
  useEffect(() => {
    if (!needsTables || tables.length) return
    api.listTables().then(setTables).catch(() => setTables([]))
  }, [needsTables, tables.length])

  // When a link field is chosen for lookup/rollup, load the target table's concrete fields.
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
      .then((d) => setTargetFields(d.fields.filter((f) => !COMPUTED_FIELD_TYPES.includes(f.type))))
      .catch(() => setTargetFields([]))
  }, [needsLinkPicker, recordLinkFieldId, linkFields])

  function buildOptions(): FieldOptions | undefined {
    if (isSelect) return { choices: choices.filter((c) => c.name.trim()) }
    if (isLinked) return { linkedTableId }
    if (isLookup) return { recordLinkFieldId, targetFieldId }
    if (isRollup)
      return {
        recordLinkFieldId,
        aggregate: aggregate as FieldOptions['aggregate'],
        ...(aggregate === 'count' && !targetFieldId ? {} : { targetFieldId }),
      }
    return undefined
  }

  function canSubmit(): boolean {
    if (!name.trim()) return false
    if (isLinked) return !!linkedTableId
    if (isLookup) return !!recordLinkFieldId && !!targetFieldId
    if (isRollup) return !!recordLinkFieldId && (aggregate === 'count' || !!targetFieldId)
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
          </>
        ) : null}

        {COMPUTED_FIELD_TYPES.includes(type) ? (
          <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: 0 }}>
            This is a computed, read-only field.
          </p>
        ) : (
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
