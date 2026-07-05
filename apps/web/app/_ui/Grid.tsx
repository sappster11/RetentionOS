'use client'

// The Airtable-parity grid. Rows = records, columns = (visible) fields.
//
// Anatomy:
//  - Frozen row-number column (sticky left): index, hover-checkbox, select-all in header.
//  - First data field frozen alongside it (sticky), stronger right border (primary field).
//  - Column headers: field-type icon + name; a trailing "+" header opens AddFieldPopover.
//  - 32px rows, 13px text, subtle separators, no vertical zebra.
//  - Cell focus: 2px blue outline; Enter commits + moves down, Tab commits + moves right,
//    Escape cancels. (Handled inside Cell; the grid tracks the focused cell coordinate.)
//  - Floating bar when rows are selected: count + Delete (bulk-delete endpoint).
//  - Pinned footer: "+ Add" (left) and "{total} records" (right).
//  - Search: rows/cells matching the query are highlighted; the grid scrolls to the first.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { EngineField, EngineTable, EnrichedRecord, FieldOptions, FieldType } from '@retentionos/engine'
import { Cell } from './Cell'
import { AddFieldPopover } from './AddFieldPopover'
import { ExpandIcon, FieldIcon, PlusIcon, TrashIcon } from './icons'

const ROWNUM_W = 56
const COL_W = 200

export function Grid({
  table,
  fields,
  records,
  total,
  search,
  onCommitCell,
  onAddRow,
  onBulkDelete,
  onAddField,
  onExpandRecord,
}: {
  table: EngineTable
  fields: EngineField[]
  records: EnrichedRecord[]
  total: number
  search: string
  onCommitCell: (record: EnrichedRecord, field: EngineField, raw: unknown) => void
  onAddRow: () => void
  onBulkDelete: (ids: string[]) => void
  onAddField: (input: { name: string; type: FieldType; options?: FieldOptions; required?: boolean }) => Promise<void>
  onExpandRecord: (record: EnrichedRecord) => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [addFieldOpen, setAddFieldOpen] = useState(false)
  // Focused cell as [rowIndex, colIndex]. colIndex indexes `fields`.
  const [focus, setFocus] = useState<{ r: number; c: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const firstMatchRef = useRef<HTMLTableCellElement>(null)

  // Selection is scoped to currently-loaded records; drop ids that disappeared.
  useEffect(() => {
    setSelected((sel) => {
      if (sel.size === 0) return sel
      const present = new Set(records.map((r) => r.id))
      const next = new Set([...sel].filter((id) => present.has(id)))
      return next.size === sel.size ? sel : next
    })
  }, [records])

  const q = search.trim().toLowerCase()
  const matchRow = useMemo(() => {
    if (!q) return () => false
    return (rec: EnrichedRecord) =>
      Object.values(rec.values).some((v) => v != null && String(v).toLowerCase().includes(q))
  }, [q])

  // Scroll to first match when search changes.
  useEffect(() => {
    if (q && firstMatchRef.current) {
      firstMatchRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [q, records])

  const allSelected = records.length > 0 && selected.size === records.length
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(records.map((r) => r.id)))
  }
  function toggleOne(id: string) {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  // Keyboard navigation between focused cells; Cell reports intent via onNavigate.
  function move(r: number, c: number, dr: number, dc: number) {
    const nr = Math.min(Math.max(r + dr, 0), records.length - 1)
    const nc = Math.min(Math.max(c + dc, 0), fields.length - 1)
    setFocus({ r: nr, c: nc })
  }

  let firstMatchSeen = false

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, position: 'relative' }}>
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <table
          style={{
            borderCollapse: 'separate',
            borderSpacing: 0,
            fontSize: 13,
            tableLayout: 'fixed',
            width: 'max-content',
          }}
        >
          <thead>
            <tr>
              {/* Row-number / select-all header (frozen) */}
              <th style={{ ...headBase, width: ROWNUM_W, left: 0, zIndex: 3, textAlign: 'center' }}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
              </th>
              {fields.map((f, ci) => {
                const frozen = ci === 0
                return (
                  <th
                    key={f.id}
                    style={{
                      ...headBase,
                      width: COL_W,
                      ...(frozen
                        ? { left: ROWNUM_W, zIndex: 3, borderRight: '2px solid var(--border-strong)' }
                        : {}),
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: 'var(--text-faint)', display: 'flex' }}>
                        <FieldIcon type={f.type} size={14} />
                      </span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {f.name}
                      </span>
                      {f.required ? <span style={{ color: 'var(--danger)' }}>*</span> : null}
                    </div>
                  </th>
                )
              })}
              {/* Add-field header */}
              <th style={{ ...headBase, width: 100, position: 'sticky', top: 0, overflow: 'visible' }}>
                <button
                  onClick={() => setAddFieldOpen((v) => !v)}
                  title="Add field"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '100%',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--text-muted)',
                  }}
                >
                  <PlusIcon size={15} />
                </button>
                {addFieldOpen ? (
                  <AddFieldPopover
                    tableId={table.id}
                    fields={fields}
                    onClose={() => setAddFieldOpen(false)}
                    onCreate={async (input) => {
                      await onAddField(input)
                      setAddFieldOpen(false)
                    }}
                  />
                ) : null}
              </th>
            </tr>
          </thead>
          <tbody>
            {records.map((rec, ri) => {
              const isSel = selected.has(rec.id)
              const rowMatches = matchRow(rec)
              return (
                <tr key={rec.id} className="grid-row" data-selected={isSel ? 'true' : undefined}>
                  {/* Row number / checkbox (frozen) */}
                  <td
                    style={{
                      ...bodyBase,
                      width: ROWNUM_W,
                      left: 0,
                      zIndex: 2,
                      textAlign: 'center',
                      background: isSel ? 'var(--selected)' : 'var(--bg)',
                      position: 'sticky',
                    }}
                  >
                    <span className="row-num" style={{ color: 'var(--text-faint)' }}>
                      {ri + 1}
                    </span>
                    <span className="row-actions" style={{ display: isSel ? 'inline-flex' : 'none', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                      <input
                        className="row-check"
                        type="checkbox"
                        checked={isSel}
                        onChange={() => toggleOne(rec.id)}
                        aria-label={`Select row ${ri + 1}`}
                      />
                      <button
                        className="row-expand"
                        title="Expand record"
                        onClick={(e) => {
                          e.stopPropagation()
                          onExpandRecord(rec)
                        }}
                        style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', padding: 0, cursor: 'pointer', display: 'inline-flex' }}
                      >
                        <ExpandIcon size={13} />
                      </button>
                    </span>
                  </td>
                  {fields.map((f, ci) => {
                    const frozen = ci === 0
                    const cellMatches = rowMatches && !!q && String(rec.values[f.id] ?? '').toLowerCase().includes(q)
                    const isFirstMatch = cellMatches && !firstMatchSeen
                    if (isFirstMatch) firstMatchSeen = true
                    const focused = focus?.r === ri && focus?.c === ci
                    return (
                      <td
                        key={f.id}
                        ref={isFirstMatch ? firstMatchRef : undefined}
                        onMouseDown={() => setFocus({ r: ri, c: ci })}
                        style={{
                          ...bodyBase,
                          width: COL_W,
                          background: cellMatches
                            ? '#fff4c9'
                            : isSel
                              ? 'var(--selected)'
                              : 'var(--bg)',
                          ...(frozen
                            ? { left: ROWNUM_W, zIndex: 1, position: 'sticky', borderRight: '2px solid var(--border-strong)' }
                            : {}),
                          ...(focused ? { boxShadow: 'inset 0 0 0 2px var(--accent)' } : {}),
                        }}
                      >
                        <Cell
                          field={f}
                          value={rec.values[f.id]}
                          display={rec.display?.[f.id]}
                          focused={focused}
                          onCommit={(raw) => onCommitCell(rec, f, raw)}
                          onNavigate={(dir) => {
                            if (dir === 'down') move(ri, ci, 1, 0)
                            else if (dir === 'right') move(ri, ci, 0, 1)
                          }}
                          onExpand={() => onExpandRecord(rec)}
                        />
                      </td>
                    )
                  })}
                  <td style={{ ...bodyBase, background: isSel ? 'var(--selected)' : 'var(--bg)' }} />
                </tr>
              )
            })}
          </tbody>
        </table>

        {fields.length === 0 ? (
          <p style={{ color: 'var(--text-faint)', margin: 16, fontSize: 13 }}>
            This table has no fields yet. Use the <strong>+</strong> column header to add one.
          </p>
        ) : null}
      </div>

      {/* Pinned footer */}
      <div
        style={{
          height: 36,
          flexShrink: 0,
          borderTop: '1px solid var(--border)',
          background: 'var(--bg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
        }}
      >
        <button
          onClick={onAddRow}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            border: 'none',
            background: 'transparent',
            color: 'var(--text-muted)',
            fontWeight: 500,
          }}
        >
          <PlusIcon size={14} />
          Add
        </button>
        <span style={{ color: 'var(--text-faint)', fontSize: 12.5 }}>
          {total} {total === 1 ? 'record' : 'records'}
        </span>
      </div>

      {/* Floating selection bar */}
      {selected.size > 0 ? (
        <div
          style={{
            position: 'absolute',
            bottom: 52,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: 'var(--text)',
            color: '#fff',
            borderRadius: 8,
            padding: '8px 14px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.24)',
            zIndex: 20,
            fontSize: 13,
          }}
        >
          <span>
            {selected.size} selected
          </span>
          <button
            onClick={() => {
              onBulkDelete([...selected])
              setSelected(new Set())
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              border: 'none',
              background: 'var(--danger)',
              color: '#fff',
              borderRadius: 6,
              padding: '5px 10px',
              fontWeight: 500,
            }}
          >
            <TrashIcon size={14} />
            Delete
          </button>
          <button
            onClick={() => setSelected(new Set())}
            style={{ border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.7)' }}
          >
            Clear
          </button>
        </div>
      ) : null}

      <style>{`
        tr.grid-row:hover td { background: var(--bg-subtle) !important; }
        tr.grid-row[data-selected="true"]:hover td { background: var(--selected) !important; }
        tr.grid-row:hover .row-num { display: none; }
        tr.grid-row:hover .row-actions { display: inline-flex !important; }
      `}</style>
    </div>
  )
}

const headBase: React.CSSProperties = {
  textAlign: 'left',
  fontWeight: 500,
  color: 'var(--text-muted)',
  padding: '0 8px',
  height: 34,
  background: 'var(--bg-subtle)',
  borderRight: '1px solid var(--border)',
  borderBottom: '1px solid var(--border)',
  position: 'sticky',
  top: 0,
  zIndex: 3,
}

const bodyBase: React.CSSProperties = {
  height: 'var(--row-h)',
  borderRight: '1px solid var(--border)',
  borderBottom: '1px solid var(--border)',
  padding: 0,
  verticalAlign: 'middle',
  background: 'var(--bg)',
}
