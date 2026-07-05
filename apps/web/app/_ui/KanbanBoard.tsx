'use client'

// The Kanban view. One column per choice of the view's groupBy single_select field, plus an
// "Uncategorized" column for null. Cards show the primary field + a couple of other visible
// fields. Dragging a card to another column PATCHes the record's select value (optimistic,
// reconciled on error). "+ Add" per column creates a record pre-set to that choice.
//
// Drag-and-drop uses native HTML5 DnD (no library) per the no-new-deps rule.
import { useMemo, useState } from 'react'
import type { EngineField, EnrichedRecord, SelectChoice } from '@retentionos/engine'
import { CHOICE_COLORS } from './Cell'
import { ExpandIcon, PlusIcon } from './icons'

const UNCATEGORIZED = '__uncategorized__'

export function KanbanBoard({
  fields,
  records,
  groupByFieldId,
  onMoveCard,
  onAddCard,
  onExpandRecord,
}: {
  fields: EngineField[]
  records: EnrichedRecord[]
  groupByFieldId: string | null | undefined
  onMoveCard: (record: EnrichedRecord, choiceId: string | null) => void
  onAddCard: (choiceId: string | null) => void
  onExpandRecord: (record: EnrichedRecord) => void
}) {
  const groupField = fields.find((f) => f.id === groupByFieldId && f.type === 'single_select')
  const [dragId, setDragId] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)

  const choices: SelectChoice[] = groupField?.options.choices ?? []
  const primaryFieldId = fields[0]?.id
  // A few other visible fields to show on the card (skip primary + the group field).
  const cardFields = useMemo(
    () => fields.filter((f) => f.id !== primaryFieldId && f.id !== groupField?.id).slice(0, 3),
    [fields, primaryFieldId, groupField?.id],
  )

  if (!groupField) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
        This Kanban view needs a single-select field to group by.
      </div>
    )
  }

  const columns: { key: string; choiceId: string | null; name: string; color: string }[] = [
    ...choices.map((c) => ({ key: c.id, choiceId: c.id, name: c.name, color: c.color })),
    { key: UNCATEGORIZED, choiceId: null, name: 'Uncategorized', color: 'gray' },
  ]

  function recordsFor(choiceId: string | null): EnrichedRecord[] {
    return records.filter((r) => {
      const v = r.values[groupField!.id]
      return choiceId === null ? v == null || v === '' : v === choiceId
    })
  }

  function primaryLabel(rec: EnrichedRecord): string {
    if (!primaryFieldId) return 'Untitled'
    const v = rec.values[primaryFieldId]
    if (v == null || v === '') return 'Untitled'
    if (Array.isArray(v)) return v.length ? String(v[0]) : 'Untitled'
    return String(v)
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowX: 'auto', overflowY: 'hidden', display: 'flex', gap: 12, padding: 14, background: 'var(--bg-subtle)' }}>
      {columns.map((col) => {
        const c = CHOICE_COLORS[col.color] ?? CHOICE_COLORS.gray!
        const colRecords = recordsFor(col.choiceId)
        const isOver = overCol === col.key
        return (
          <div
            key={col.key}
            onDragOver={(e) => {
              e.preventDefault()
              setOverCol(col.key)
            }}
            onDragLeave={() => setOverCol((o) => (o === col.key ? null : o))}
            onDrop={(e) => {
              e.preventDefault()
              setOverCol(null)
              const rec = records.find((r) => r.id === dragId)
              setDragId(null)
              if (rec && rec.values[groupField.id] !== col.choiceId) onMoveCard(rec, col.choiceId)
            }}
            style={{
              width: 272,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              background: isOver ? 'var(--accent-soft)' : 'transparent',
              borderRadius: 8,
              transition: 'background 0.12s',
            }}
          >
            {/* Column header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 4px 10px' }}>
              <span style={{ background: c.bg, color: c.fg, borderRadius: 10, padding: '2px 10px', fontSize: 12, fontWeight: 500 }}>
                {col.name}
              </span>
              <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{colRecords.length}</span>
            </div>

            {/* Cards */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 8 }}>
              {colRecords.map((rec) => (
                <div
                  key={rec.id}
                  draggable
                  onDragStart={() => setDragId(rec.id)}
                  onDragEnd={() => setDragId(null)}
                  className="kanban-card"
                  style={{
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '10px 12px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                    cursor: 'grab',
                    opacity: dragId === rec.id ? 0.5 : 1,
                    position: 'relative',
                  }}
                >
                  <button
                    className="kanban-expand"
                    title="Expand record"
                    onClick={() => onExpandRecord(rec)}
                    style={{ position: 'absolute', top: 6, right: 6, border: 'none', background: 'transparent', color: 'var(--text-faint)', cursor: 'pointer', display: 'none', padding: 2 }}
                  >
                    <ExpandIcon size={12} />
                  </button>
                  <div style={{ fontWeight: 500, fontSize: 13, marginBottom: cardFields.length ? 6 : 0, paddingRight: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {primaryLabel(rec)}
                  </div>
                  {cardFields.map((f) => {
                    const text = cardValue(f, rec)
                    if (!text) return null
                    return (
                      <div key={f.id} style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <span style={{ color: 'var(--text-faint)' }}>{f.name}: </span>
                        {text}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>

            {/* Add card */}
            <button
              onClick={() => onAddCard(col.choiceId)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, border: 'none', background: 'transparent', color: 'var(--text-muted)', padding: '6px 4px', fontSize: 12.5, cursor: 'pointer' }}
            >
              <PlusIcon size={13} /> Add
            </button>
          </div>
        )
      })}
      <style>{`.kanban-card:hover .kanban-expand { display: block !important; }`}</style>
    </div>
  )
}

/** A short display string for a card sub-field (chips/labels collapsed to text). */
function cardValue(field: EngineField, rec: EnrichedRecord): string {
  if (field.type === 'linked_record') {
    const refs = (rec.display[field.id] as { label: string }[]) ?? []
    return refs.map((r) => r.label).join(', ')
  }
  if (field.type === 'lookup') {
    const d = rec.display[field.id]
    return Array.isArray(d) ? d.map((v) => (v == null ? '' : String(v))).join(', ') : ''
  }
  if (field.type === 'rollup' || field.type === 'autonumber') {
    const d = rec.display[field.id]
    return d == null ? '' : String(d)
  }
  if (field.type === 'created_time' || field.type === 'last_modified_time') {
    const d = rec.display[field.id]
    return d ? new Date(String(d)).toLocaleDateString(undefined, { dateStyle: 'medium' }) : ''
  }
  if (field.type === 'multi_select') {
    const ids = Array.isArray(rec.values[field.id]) ? (rec.values[field.id] as string[]) : []
    const byId = new Map((field.options.choices ?? []).map((c) => [c.id, c.name]))
    return ids.map((id) => byId.get(id) ?? id).join(', ')
  }
  if (field.type === 'single_select') {
    const id = rec.values[field.id]
    const c = (field.options.choices ?? []).find((x) => x.id === id)
    return c?.name ?? ''
  }
  if (field.type === 'checkbox') return rec.values[field.id] === true ? '✓' : ''
  const v = rec.values[field.id]
  return v == null || v === '' ? '' : String(v)
}
