'use client'

// A single editable grid cell, rendered per field type. Editing is inline: click to edit,
// blur / Enter commits (calls onCommit with the raw value the engine will coerce), Escape
// cancels. Selects, checkboxes, and dates get type-appropriate controls.
import { useEffect, useRef, useState } from 'react'
import type { Attachment, EngineField, LinkedRecordRef, SelectChoice } from '@retentionos/engine'

// Airtable-ish "Light2" pastels — soft fills with a legible dark text tone. Extra names
// (teal/pink/cyan) map to Airtable's tealLight2 / pinkLight2 / cyanLight2 equivalents.
const CHOICE_COLORS: Record<string, { bg: string; fg: string }> = {
  gray: { bg: '#e5e9ed', fg: '#464b52' },
  blue: { bg: '#cfdfff', fg: '#2750ae' },
  cyan: { bg: '#cbf0ff', fg: '#0b6b93' },
  teal: { bg: '#c2f5e9', fg: '#0b6b5b' },
  green: { bg: '#d1f7c4', fg: '#337321' },
  yellow: { bg: '#ffeab6', fg: '#7a5b12' },
  orange: { bg: '#ffdcc7', fg: '#a54800' },
  red: { bg: '#ffdce5', fg: '#aa2947' },
  pink: { bg: '#ffdaf3', fg: '#9c2b7f' },
  purple: { bg: '#ede2fe', fg: '#6b3fa0' },
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

const cellPad = '0 8px'

type NavDir = 'down' | 'right'

export function Cell({
  field,
  value,
  display,
  onCommit,
  focused,
  onNavigate,
  onExpand,
}: {
  field: EngineField
  value: unknown
  display?: unknown
  onCommit: (raw: unknown) => void
  focused?: boolean
  onNavigate?: (dir: NavDir) => void
  onExpand?: () => void
}) {
  const [editing, setEditing] = useState(false)
  const choices: SelectChoice[] = field.options.choices ?? []
  const choiceById = new Map(choices.map((c) => [c.id, c]))

  // --- Phase B read-only + relation renderers --------------------------------
  if (field.type === 'linked_record') {
    const refs = Array.isArray(display) ? (display as LinkedRecordRef[]) : []
    return (
      <div
        onClick={() => onExpand?.()}
        title="Open record to edit links"
        style={{ display: 'flex', gap: 4, alignItems: 'center', padding: cellPad, height: 'var(--row-h)', overflow: 'hidden', cursor: 'pointer' }}
      >
        {refs.length === 0 ? (
          <span style={{ color: 'var(--text-faint)' }} />
        ) : (
          refs.map((r) => (
            <span key={r.id} style={{ ...chipStyle('blue'), display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              {r.label}
            </span>
          ))
        )}
      </div>
    )
  }

  if (field.type === 'attachment') {
    const atts = Array.isArray(value) ? (value as Attachment[]) : []
    return <AttachmentCell field={field} attachments={atts} onCommit={onCommit} />
  }

  if (field.type === 'lookup' || field.type === 'rollup') {
    const d = display
    let text = ''
    if (Array.isArray(d)) text = d.map((v) => (v == null ? '' : String(v))).join(', ')
    else if (d != null) text = String(d)
    return (
      <div style={{ padding: cellPad, height: 'var(--row-h)', display: 'flex', alignItems: 'center', color: 'var(--text-muted)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {text}
      </div>
    )
  }

  if (field.type === 'autonumber' || field.type === 'created_time' || field.type === 'last_modified_time') {
    const d = display ?? value
    let text = ''
    if (d != null && d !== '') {
      if (field.type === 'autonumber') {
        text = String(d)
      } else {
        // created/last_modified render a date; an unparseable value shows empty, not "Invalid Date".
        const parsed = new Date(String(d))
        text = isNaN(parsed.getTime())
          ? ''
          : parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
      }
    }
    return (
      <div style={{ padding: cellPad, height: 'var(--row-h)', display: 'flex', alignItems: 'center', justifyContent: field.type === 'autonumber' ? 'flex-end' : 'flex-start', color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {text}
      </div>
    )
  }

  // Non-text controls render inline (no click-to-edit dance).
  if (field.type === 'checkbox') {
    return (
      <div style={{ height: 'var(--row-h)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onCommit(e.target.checked)}
        />
      </div>
    )
  }

  if (field.type === 'single_select') {
    const sel = typeof value === 'string' ? value : ''
    const selChoice = sel ? choiceById.get(sel) : undefined
    return (
      <div style={{ position: 'relative', height: 'var(--row-h)', display: 'flex', alignItems: 'center', padding: cellPad }}>
        {selChoice ? (
          <span style={chipStyle(selChoice.color)}>{selChoice.name}</span>
        ) : (
          <span style={{ color: 'var(--text-faint)' }} />
        )}
        <select
          value={sel}
          onChange={(e) => onCommit(e.target.value || null)}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            border: 'none',
            background: 'transparent',
            outline: 'none',
            color: 'transparent',
            opacity: 0,
            cursor: 'pointer',
          }}
        >
          <option value="">—</option>
          {choices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
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
    let datetimeVal = ''
    if (!isDate && raw) {
      const d = new Date(raw)
      const pad = (n: number) => String(n).padStart(2, '0')
      datetimeVal = isNaN(d.getTime())
        ? ''
        : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    }
    const inputVal = isDate ? raw.slice(0, 10) : datetimeVal
    return (
      <input
        type={isDate ? 'date' : 'datetime-local'}
        value={inputVal}
        onChange={(e) => {
          const v = e.target.value
          if (!v) return onCommit(null)
          onCommit(isDate ? v : new Date(v).toISOString())
        }}
        style={{ width: '100%', height: 'var(--row-h)', border: 'none', background: 'transparent', padding: cellPad, outline: 'none' }}
      />
    )
  }

  // text / long_text / number / currency / url / email — click to edit.
  if (editing) {
    return (
      <TextEditor
        field={field}
        initial={value}
        onDone={(raw, nav) => {
          setEditing(false)
          if (raw !== undefined) onCommit(raw)
          if (nav) onNavigate?.(nav)
        }}
      />
    )
  }

  let rendered: React.ReactNode = value == null || value === '' ? '' : String(value)
  if (field.type === 'currency' && value != null && value !== '') rendered = fmtCurrency(value, field)
  if (field.type === 'url' && typeof value === 'string' && value) {
    rendered = (
      <a
        href={value}
        target="_blank"
        rel="noreferrer"
        style={{
          color: 'var(--accent)',
          textDecoration: 'underline',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          display: 'inline-block',
          maxWidth: '100%',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {value}
      </a>
    )
  }

  const numeric = field.type === 'number' || field.type === 'currency'
  return (
    <div
      onClick={() => setEditing(true)}
      onKeyDown={(e) => {
        // When the cell is focused (not editing), Enter/Tab navigate; typing starts edit.
        if (!focused) return
        if (e.key === 'Enter') {
          e.preventDefault()
          onNavigate?.('down')
        } else if (e.key === 'Tab') {
          e.preventDefault()
          onNavigate?.('right')
        } else if (e.key.length === 1) {
          setEditing(true)
        }
      }}
      tabIndex={focused ? 0 : -1}
      ref={(el) => {
        if (focused && el) el.focus()
      }}
      style={{
        padding: cellPad,
        height: 'var(--row-h)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: numeric ? 'flex-end' : 'flex-start',
        cursor: 'text',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        outline: 'none',
      }}
    >
      {rendered}
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
  onDone: (raw: unknown, nav?: 'down' | 'right') => void
}) {
  const [val, setVal] = useState(initial == null ? '' : String(initial))
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const numeric = field.type === 'number' || field.type === 'currency'
  const commitVal = () => (val === '' ? null : val)

  return (
    <input
      ref={ref}
      value={val}
      inputMode={numeric ? 'decimal' : undefined}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => onDone(commitVal())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onDone(commitVal(), 'down')
        } else if (e.key === 'Tab') {
          e.preventDefault()
          onDone(commitVal(), 'right')
        } else if (e.key === 'Escape') {
          onDone(undefined)
        }
      }}
      style={{
        width: '100%',
        height: 'calc(var(--row-h) - 2px)',
        border: '2px solid var(--accent)',
        borderRadius: 3,
        padding: '0 6px',
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
    <div style={{ position: 'relative', padding: cellPad, height: 'var(--row-h)', display: 'flex', alignItems: 'center' }}>
      <div
        onClick={() => setOpen((v) => !v)}
        style={{ display: 'flex', gap: 4, flexWrap: 'nowrap', overflow: 'hidden', cursor: 'pointer', width: '100%' }}
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

function AttachmentCell({
  field,
  attachments,
  onCommit,
}: {
  field: EngineField
  attachments: Attachment[]
  onCommit: (raw: unknown) => void
}) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')

  function add() {
    const u = url.trim()
    if (!u) return
    onCommit([...attachments, { url: u, ...(name.trim() ? { name: name.trim() } : {}) }])
    setUrl('')
    setName('')
  }
  function remove(i: number) {
    onCommit(attachments.filter((_, j) => j !== i))
  }

  function isImage(u: string) {
    return /\.(png|jpe?g|gif|webp|svg|avif)(\?|$)/i.test(u)
  }
  function favicon(u: string) {
    try {
      return `${new URL(u).origin}/favicon.ico`
    } catch {
      return ''
    }
  }

  return (
    <div style={{ position: 'relative', padding: cellPad, height: 'var(--row-h)', display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
      <div onClick={() => setOpen((v) => !v)} style={{ display: 'flex', gap: 4, cursor: 'pointer', overflow: 'hidden', flex: 1 }}>
        {attachments.map((a, i) => (
          <span key={i} style={{ ...chipStyle('gray'), display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <img
              src={isImage(a.url) ? a.url : favicon(a.url)}
              alt=""
              width={12}
              height={12}
              style={{ borderRadius: 2, objectFit: 'cover' }}
              onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')}
            />
            {a.name ?? a.url.split('/').pop() ?? 'file'}
          </span>
        ))}
      </div>
      {open ? (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 20,
            background: 'var(--bg)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius)',
            boxShadow: '0 6px 20px rgba(0,0,0,0.14)',
            padding: 8,
            minWidth: 240,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {attachments.map((a, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <a href={a.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {a.name ?? a.url}
              </a>
              <button onClick={() => remove(i)} style={{ border: 'none', background: 'transparent', color: 'var(--danger)', cursor: 'pointer' }}>
                ×
              </button>
            </div>
          ))}
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a URL" style={miniInput} />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" style={miniInput} />
          <button onClick={add} style={{ border: 'none', background: 'var(--accent)', color: '#fff', borderRadius: 4, padding: '4px 8px', cursor: 'pointer' }}>
            Add
          </button>
        </div>
      ) : null}
    </div>
  )
}

const miniInput: React.CSSProperties = {
  padding: '5px 7px',
  border: '1px solid var(--border-strong)',
  borderRadius: 6,
  background: 'var(--bg)',
  color: 'var(--text)',
  outline: 'none',
  fontSize: 12,
}

export { CHOICE_COLORS, chipStyle }
