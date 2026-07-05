'use client'

import { useState } from 'react'
import type { FieldOptions, FieldType, SelectChoice } from '@retentionos/engine'
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
}

const TYPES = Object.keys(FIELD_TYPE_LABELS) as FieldType[]
const COLOR_NAMES = Object.keys(CHOICE_COLORS)

let choiceSeq = 0
function newChoiceId() {
  choiceSeq += 1
  return `ch_${Date.now().toString(36)}_${choiceSeq}`
}

export function AddFieldPopover({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (input: { name: string; type: FieldType; options?: FieldOptions; required?: boolean }) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState<FieldType>('text')
  const [required, setRequired] = useState(false)
  const [choices, setChoices] = useState<SelectChoice[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isSelect = type === 'single_select' || type === 'multi_select'

  async function submit() {
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    try {
      await onCreate({
        name: name.trim(),
        type,
        required,
        options: isSelect ? { choices: choices.filter((c) => c.name.trim()) } : undefined,
      })
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

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          Required
        </label>

        {error ? <p style={{ color: 'var(--danger)', fontSize: 12, margin: 0 }}>{error}</p> : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <button onClick={onClose} style={{ ...buttonGhost, padding: '5px 10px' }}>
            Cancel
          </button>
          <button onClick={submit} disabled={busy || !name.trim()} style={{ ...buttonPrimary, padding: '5px 10px' }}>
            {busy ? 'Adding…' : 'Add field'}
          </button>
        </div>
      </div>
    </div>
  )
}

export { FIELD_TYPE_LABELS }
