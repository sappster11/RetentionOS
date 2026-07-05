'use client'

// The spreadsheet-style grid: renders records as rows, fields as columns. Inline cell
// editing per field type (Cell), an add-row button, and an add-field column header
// (AddFieldPopover). All mutations go through /api/v1 via the api client. State is held
// locally and reconciled from the server response of each call.
import { useState } from 'react'
import type { EngineField, EngineRecord, EngineTable, FieldOptions, FieldType } from '@retentionos/engine'
import { api } from './apiClient'
import { Cell } from './Cell'
import { AddFieldPopover, FIELD_TYPE_LABELS } from './AddFieldPopover'

const TYPE_ICON: Record<FieldType, string> = {
  text: 'A',
  long_text: '¶',
  single_select: '⏷',
  multi_select: '☰',
  number: '#',
  currency: '$',
  checkbox: '☑',
  date: '📅',
  datetime: '🕐',
  url: '🔗',
  email: '@',
}

export function Grid({
  table,
  initialFields,
  initialRecords,
}: {
  table: EngineTable
  initialFields: EngineField[]
  initialRecords: EngineRecord[]
}) {
  const [fields, setFields] = useState<EngineField[]>(initialFields)
  const [records, setRecords] = useState<EngineRecord[]>(initialRecords)
  const [addFieldOpen, setAddFieldOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function commitCell(record: EngineRecord, field: EngineField, raw: unknown) {
    setError(null)
    // Optimistic local update, reconciled by the server response.
    setRecords((rs) =>
      rs.map((r) => (r.id === record.id ? { ...r, values: { ...r.values, [field.id]: raw } } : r)),
    )
    try {
      const updated = await api.updateRecord(table.id, record.id, { [field.id]: raw })
      setRecords((rs) => rs.map((r) => (r.id === updated.id ? updated : r)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed.')
      // Reload the record from server to undo the optimistic change.
      try {
        const page = await api.queryRecords(table.id, { limit: 200 })
        setRecords(page.records)
      } catch {
        /* leave optimistic state; the error is already surfaced */
      }
    }
  }

  async function addRow() {
    setError(null)
    try {
      const rec = await api.createRecord(table.id, {})
      setRecords((rs) => [...rs, rec])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add row.')
    }
  }

  async function deleteRow(id: string) {
    setError(null)
    const prev = records
    setRecords((rs) => rs.filter((r) => r.id !== id))
    try {
      await api.deleteRecord(table.id, id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.')
      setRecords(prev)
    }
  }

  async function addField(input: {
    name: string
    type: FieldType
    options?: FieldOptions
    required?: boolean
  }) {
    const field = await api.createField(table.id, input)
    setFields((fs) => [...fs, field])
    setAddFieldOpen(false)
  }

  const colWidth = 200

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={{ padding: '14px 16px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 18 }}>{table.icon ?? '▦'}</span>
        <h1 style={{ fontSize: 17, margin: 0 }}>{table.name}</h1>
        {table.description ? (
          <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>· {table.description}</span>
        ) : null}
      </div>

      {error ? (
        <div style={{ margin: '0 16px 8px', color: 'var(--danger)', fontSize: 12 }}>{error}</div>
      ) : null}

      <div style={{ overflow: 'auto', padding: '0 16px 24px' }}>
        <table
          style={{
            borderCollapse: 'separate',
            borderSpacing: 0,
            fontSize: 13,
            tableLayout: 'fixed',
          }}
        >
          <thead>
            <tr>
              <th style={{ ...headStyle, width: 40, textAlign: 'center' }}>#</th>
              {fields.map((f) => (
                <th key={f.id} style={{ ...headStyle, width: colWidth }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                      title={FIELD_TYPE_LABELS[f.type]}
                      style={{ color: 'var(--text-faint)', width: 14, textAlign: 'center' }}
                    >
                      {TYPE_ICON[f.type]}
                    </span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.name}
                    </span>
                    {f.required ? <span style={{ color: 'var(--danger)' }}>*</span> : null}
                  </div>
                </th>
              ))}
              <th style={{ ...headStyle, width: 120, position: 'relative' }}>
                <button
                  onClick={() => setAddFieldOpen((v) => !v)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--text-muted)',
                    fontWeight: 500,
                  }}
                >
                  + Add field
                </button>
                {addFieldOpen ? (
                  <AddFieldPopover onClose={() => setAddFieldOpen(false)} onCreate={addField} />
                ) : null}
              </th>
            </tr>
          </thead>
          <tbody>
            {records.map((r, i) => (
              <tr key={r.id} className="grid-row">
                <td style={{ ...cellTd, width: 40, textAlign: 'center', color: 'var(--text-faint)', position: 'relative' }}>
                  <span className="row-num">{i + 1}</span>
                  <button
                    className="row-del"
                    onClick={() => deleteRow(r.id)}
                    title="Delete row"
                    style={{
                      display: 'none',
                      position: 'absolute',
                      inset: 0,
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--danger)',
                    }}
                  >
                    ×
                  </button>
                </td>
                {fields.map((f) => (
                  <td key={f.id} style={{ ...cellTd, width: colWidth }}>
                    <Cell field={f} value={r.values[f.id]} onCommit={(raw) => commitCell(r, f, raw)} />
                  </td>
                ))}
                <td style={cellTd} />
              </tr>
            ))}
          </tbody>
        </table>

        <button
          onClick={addRow}
          style={{
            marginTop: 6,
            padding: '7px 12px',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            background: 'var(--bg)',
            color: 'var(--text-muted)',
          }}
        >
          + Add row
        </button>

        {fields.length === 0 ? (
          <p style={{ color: 'var(--text-faint)', marginTop: 16, fontSize: 13 }}>
            This table has no fields yet. Use <strong>+ Add field</strong> to add columns.
          </p>
        ) : null}
      </div>

      {/* Hover affordance: show the delete-× over the row number. */}
      <style>{`
        tr.grid-row:hover .row-num { display: none; }
        tr.grid-row:hover .row-del { display: block !important; }
        tr.grid-row:hover td { background: var(--bg-subtle); }
      `}</style>
    </div>
  )
}

const headStyle: React.CSSProperties = {
  textAlign: 'left',
  fontWeight: 500,
  color: 'var(--text-muted)',
  padding: '6px 8px',
  background: 'var(--bg-subtle)',
  border: '1px solid var(--border)',
  borderLeft: 'none',
  position: 'sticky',
  top: 0,
}

const cellTd: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderLeft: 'none',
  borderTop: 'none',
  padding: 0,
  verticalAlign: 'top',
}
