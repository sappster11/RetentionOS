'use client'

// A single editable grid cell, rendered per field type. Editing is inline: click to edit,
// blur / Enter commits (calls onCommit with the raw value the engine will coerce), Escape
// cancels. Selects, checkboxes, and dates get type-appropriate controls.
import { useEffect, useRef, useState } from 'react'
import type { EngineField, SelectChoice } from '@retentionos/engine'

const CHOICE_COLORS: Record<string, { bg: string; fg: string }> = {
  gray: { bg: '#e6e6e8', fg: '#3a3a3d' },
  blue: { bg: '#d9e8fb', fg: '#1a4e8a' },
  green: { bg: '#d7f0dd', fg: '#1f6b39' },
  red: { bg: '#fbdcdc', fg: '#9a2626' },
  yellow: { bg: '#f7edc9', fg: '#7a5c12' },
  purple: { bg: '#e7ddf7', fg: '#5b3a95' },
  orange: { bg: '#fbe4cf', fg: '#8a4f14' },
}

function chipStyle(color: string) {
  const c = CHOICE_COLORS[color] ?? CHOICE_COLORS.gray!
  return {
    background: c.bg,
    color: c.fg,
    borderRadius: 10,
    padding: '1px 8px',
    fontSize: 12,
    display: 'inline-block',
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  }
}

function fmtCurrency(v: unknown, field: EngineField): string {
  const n = Number(v)
  if (Number.isNaN(n)) return ''
  const sym = field.options.currencySymbol ?? '$'
  return `${sym}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const cellPad = '6px 8px'

export function Cell({
  field,
  value,
  onCommit,
}: {
  field: EngineField
  value: unknown
  onCommit: (raw: unknown) => void
}) {
  const [editing, setEditing] = useState(false)
  const choices: SelectChoice[] = field.options.choices ?? []
  const choiceById = new Map(choices.map((c) => [c.id, c]))

  // Non-text controls render inline (no click-to-edit dance).
  if (field.type === 'checkbox') {
    return (
      <div style={{ padding: cellPad, textAlign: 'center' }}>
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onCommit(e.target.checked)}
        />
      </div>
    )
  }

  if (field.type === 'single_select') {
    return (
      <select
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onCommit(e.target.value || null)}
        style={{
          width: '100%',
          border: 'none',
          background: 'transparent',
          padding: cellPad,
          outline: 'none',
          color: 'var(--text)',
        }}
      >
        <option value="">—</option>
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    )
  }

  if (field.type === 'multi_select') {
    return (
      <MultiSelectCell field={field} value={value} onCommit={onCommit} />
    )
  }

  if (field.type === 'date' || field.type === 'datetime') {
    const isDate = field.type === 'date'
    const raw = typeof value === 'string' ? value : ''
    const inputVal = isDate ? raw.slice(0, 10) : raw ? new Date(raw).toISOString().slice(0, 16) : ''
    return (
      <input
        type={isDate ? 'date' : 'datetime-local'}
        value={inputVal}
        onChange={(e) => {
          const v = e.target.value
          if (!v) return onCommit(null)
          onCommit(isDate ? v : new Date(v).toISOString())
        }}
        style={{ width: '100%', border: 'none', background: 'transparent', padding: cellPad, outline: 'none' }}
      />
    )
  }

  // text / long_text / number / currency / url / email — click to edit.
  if (editing) {
    return (
      <TextEditor
        field={field}
        initial={value}
        onDone={(raw) => {
          setEditing(false)
          if (raw !== undefined) onCommit(raw)
        }}
      />
    )
  }

  let display: React.ReactNode = value == null || value === '' ? '' : String(value)
  if (field.type === 'currency' && value != null && value !== '') display = fmtCurrency(value, field)
  if (field.type === 'url' && typeof value === 'string' && value) {
    display = (
      <a href={value} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }} onClick={(e) => e.stopPropagation()}>
        {value}
      </a>
    )
  }

  return (
    <div
      onClick={() => setEditing(true)}
      style={{
        padding: cellPad,
        minHeight: 30,
        cursor: 'text',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: field.type === 'long_text' ? 'normal' : 'nowrap',
        textAlign: field.type === 'number' || field.type === 'currency' ? 'right' : 'left',
      }}
    >
      {display}
    </div>
  )
}

function TextEditor({
  field,
  initial,
  onDone,
}: {
  field: EngineField
  initial: unknown
  onDone: (raw: unknown) => void
}) {
  const [val, setVal] = useState(initial == null ? '' : String(initial))
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const numeric = field.type === 'number' || field.type === 'currency'

  return (
    <input
      ref={ref}
      value={val}
      inputMode={numeric ? 'decimal' : undefined}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => onDone(val === '' ? null : val)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(val === '' ? null : val)
        if (e.key === 'Escape') onDone(undefined)
      }}
      style={{
        width: '100%',
        border: '2px solid var(--accent)',
        borderRadius: 3,
        padding: '4px 6px',
        outline: 'none',
        textAlign: numeric ? 'right' : 'left',
      }}
    />
  )
}

function MultiSelectCell({
  field,
  value,
  onCommit,
}: {
  field: EngineField
  value: unknown
  onCommit: (raw: unknown) => void
}) {
  const [open, setOpen] = useState(false)
  const choices: SelectChoice[] = field.options.choices ?? []
  const selected = Array.isArray(value) ? (value as string[]) : []
  const byId = new Map(choices.map((c) => [c.id, c]))

  function toggle(id: string) {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
    onCommit(next)
  }

  return (
    <div style={{ position: 'relative', padding: cellPad, minHeight: 30 }}>
      <div
        onClick={() => setOpen((v) => !v)}
        style={{ display: 'flex', gap: 4, flexWrap: 'wrap', cursor: 'pointer', minHeight: 18 }}
      >
        {selected.map((id) => {
          const c = byId.get(id)
          return c ? (
            <span key={id} style={chipStyle(c.color)}>
              {c.name}
            </span>
          ) : null
        })}
      </div>
      {open ? (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 20,
            background: 'var(--bg)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius)',
            boxShadow: '0 6px 20px rgba(0,0,0,0.14)',
            padding: 6,
            minWidth: 160,
          }}
        >
          {choices.map((c) => (
            <label
              key={c.id}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', cursor: 'pointer' }}
            >
              <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
              <span style={chipStyle(c.color)}>{c.name}</span>
            </label>
          ))}
          <button
            onClick={() => setOpen(false)}
            style={{ width: '100%', marginTop: 4, border: 'none', background: 'var(--bg-hover)', borderRadius: 4, padding: 4 }}
          >
            Done
          </button>
        </div>
      ) : null}
    </div>
  )
}

export { CHOICE_COLORS, chipStyle }
