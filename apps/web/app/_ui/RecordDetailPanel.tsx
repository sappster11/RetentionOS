'use client'

// The record detail overlay — a right-side panel (not a route) opened from the grid's row
// expand icon or a linked-record cell. It stacks every visible field vertically using the
// same inline editors the grid uses, renders linked_record fields as chips + a search picker,
// shows computed fields read-only with a type badge, and lists the record's revision history
// (actor icon, relative time, per-field before→after) below.
import { useCallback, useEffect, useState } from 'react'
import type {
  EngineField,
  EngineRecordRevision,
  EngineTable,
  EnrichedRecord,
  LinkedRecordRef,
} from '@retentionos/engine'
import { isComputedType } from './fieldMeta'
import { api } from './apiClient'
import { Cell } from './Cell'
import { LinkedRecordPicker } from './LinkedRecordPicker'
import { BotIcon, CloseIcon, FieldIcon, HistoryIcon, UserIcon } from './icons'

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const secs = Math.round((Date.now() - then) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

const TYPE_BADGE: Partial<Record<EngineField['type'], string>> = {
  lookup: 'Lookup',
  rollup: 'Rollup',
  autonumber: 'Autonumber',
  created_time: 'Created',
  last_modified_time: 'Modified',
}

export function RecordDetailPanel({
  table,
  fields,
  record,
  fieldLabel,
  onClose,
  onCommitCell,
  onLinksChanged,
}: {
  table: EngineTable
  fields: EngineField[]
  record: EnrichedRecord
  /** The record's own primary-field value, shown as the panel title. */
  fieldLabel: string
  onClose: () => void
  onCommitCell: (field: EngineField, raw: unknown) => void | Promise<void>
  onLinksChanged: (fieldId: string, ids: string[]) => void | Promise<void>
}) {
  const [revisions, setRevisions] = useState<EngineRecordRevision[] | null>(null)
  const [pickerFieldId, setPickerFieldId] = useState<string | null>(null)

  // Close on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const loadRevisions = useCallback(() => {
    api
      .listRevisions(table.id, record.id)
      .then(setRevisions)
      .catch(() => setRevisions([]))
  }, [table.id, record.id])

  useEffect(() => {
    loadRevisions()
  }, [loadRevisions])

  const fieldName = new Map(fields.map((f) => [f.id, f.name]))

  return (
    <>
      <div onClick={onClose} style={overlayStyle} />
      <aside style={panelStyle} role="dialog" aria-label="Record detail">
        {/* Header */}
        <div style={headerStyle}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 15, overflow: 'hidden' }}>
            <span style={{ fontSize: 15 }}>{table.icon ?? '▦'}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {fieldLabel || 'Untitled record'}
            </span>
          </span>
          <button onClick={onClose} title="Close" style={iconBtn}>
            <CloseIcon size={16} />
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {/* Fields */}
          <div style={{ padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {fields.map((f) => {
              const computed = isComputedType(f.type)
              return (
                <div key={f.id} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                    <span style={{ color: 'var(--text-faint)', display: 'flex' }}>
                      <FieldIcon type={f.type} size={13} />
                    </span>
                    <span style={{ fontWeight: 500 }}>{f.name}</span>
                    {f.required ? <span style={{ color: 'var(--danger)' }}>*</span> : null}
                    {TYPE_BADGE[f.type] ? (
                      <span style={badgeStyle}>{TYPE_BADGE[f.type]}</span>
                    ) : null}
                  </div>

                  {f.type === 'linked_record' ? (
                    <LinkedFieldEditor
                      field={f}
                      refs={(record.display[f.id] as LinkedRecordRef[]) ?? []}
                      open={pickerFieldId === f.id}
                      onToggle={() => setPickerFieldId((p) => (p === f.id ? null : f.id))}
                      onChange={(ids) => {
                        // Reload history only AFTER the PATCH lands, so it reflects the new revision.
                        void Promise.resolve(onLinksChanged(f.id, ids)).then(loadRevisions)
                      }}
                    />
                  ) : (
                    <div style={{ border: '1px solid var(--border)', borderRadius: 6, minHeight: 34, display: 'flex', alignItems: 'stretch' }}>
                      <div style={{ flex: 1 }}>
                        <Cell
                          field={f}
                          value={record.values[f.id]}
                          display={record.display[f.id]}
                          onCommit={(raw) => {
                            if (computed) return
                            // Reload history only AFTER the PATCH resolves (new revision is visible).
                            void Promise.resolve(onCommitCell(f, raw)).then(loadRevisions)
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Revision history */}
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-faint)', marginBottom: 10 }}>
              <HistoryIcon size={13} />
              History
            </div>
            {revisions === null ? (
              <p style={{ color: 'var(--text-faint)', fontSize: 12 }}>Loading…</p>
            ) : revisions.length === 0 ? (
              <p style={{ color: 'var(--text-faint)', fontSize: 12 }}>No history yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {revisions.map((rev) => (
                  <RevisionRow key={rev.id} rev={rev} fieldName={fieldName} />
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  )
}

function LinkedFieldEditor({
  field,
  refs,
  open,
  onToggle,
  onChange,
}: {
  field: EngineField
  refs: LinkedRecordRef[]
  open: boolean
  onToggle: () => void
  onChange: (ids: string[]) => void
}) {
  const linkedTableId = field.options.linkedTableId
  return (
    <div style={{ position: 'relative' }}>
      <div
        onClick={onToggle}
        style={{ border: '1px solid var(--border)', borderRadius: 6, minHeight: 34, padding: '5px 8px', display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', cursor: 'pointer' }}
      >
        {refs.length === 0 ? (
          <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>+ Link a record</span>
        ) : (
          refs.map((r) => (
            <span
              key={r.id}
              style={{ background: '#cfdfff', color: '#2750ae', borderRadius: 10, padding: '2px 8px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              {r.label}
              <button
                title="Unlink"
                onClick={(e) => {
                  e.stopPropagation()
                  onChange(refs.filter((x) => x.id !== r.id).map((x) => x.id))
                }}
                style={{ border: 'none', background: 'transparent', color: '#2750ae', cursor: 'pointer', padding: 0, lineHeight: 1 }}
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>
      {open && linkedTableId ? (
        <LinkedRecordPicker
          linkedTableId={linkedTableId}
          selectedIds={refs.map((r) => r.id)}
          onPick={(id) => {
            if (refs.some((r) => r.id === id)) return
            onChange([...refs.map((r) => r.id), id])
          }}
          onClose={onToggle}
        />
      ) : null}
    </div>
  )
}

function RevisionRow({
  rev,
  fieldName,
}: {
  rev: EngineRecordRevision
  fieldName: Map<string, string>
}) {
  const Icon = rev.actor_type === 'agent' ? BotIcon : UserIcon
  const opLabel = rev.op === 'create' ? 'created' : rev.op === 'delete' ? 'deleted' : 'edited'
  const changes = Object.entries(rev.diff)
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 12 }}>
      <span style={{ color: 'var(--text-faint)', marginTop: 1 }}>
        <Icon size={13} />
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ color: 'var(--text-muted)' }}>
          <strong style={{ color: 'var(--text)' }}>{rev.actor_type}</strong> {opLabel}
          {rev.actor_id ? <span style={{ color: 'var(--text-faint)' }}> · {rev.actor_id}</span> : null}
          <span style={{ color: 'var(--text-faint)' }}> · {relativeTime(rev.created_at)}</span>
        </div>
        {rev.op !== 'delete' && changes.length > 0 ? (
          <div style={{ marginTop: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {changes.map(([fid, d]) => (
              <div key={fid} style={{ color: 'var(--text-muted)' }}>
                <span style={{ color: 'var(--text-faint)' }}>{fieldName.get(fid) ?? 'field'}: </span>
                <span style={{ textDecoration: 'line-through', color: 'var(--text-faint)' }}>{fmt(d.from)}</span>
                {' → '}
                <span>{fmt(d.to)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function fmt(v: unknown): string {
  if (v == null || v === '') return '∅'
  if (Array.isArray(v)) return v.length ? `${v.length} item${v.length === 1 ? '' : 's'}` : '∅'
  return String(v)
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.18)',
  zIndex: 90,
}

const panelStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  width: 'min(560px, 92vw)',
  background: 'var(--bg)',
  borderLeft: '1px solid var(--border-strong)',
  boxShadow: '-8px 0 30px rgba(0,0,0,0.12)',
  zIndex: 100,
  display: 'flex',
  flexDirection: 'column',
}

const headerStyle: React.CSSProperties = {
  height: 52,
  flexShrink: 0,
  borderBottom: '1px solid var(--border)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 16px',
}

const iconBtn: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--text-muted)',
  cursor: 'pointer',
  display: 'flex',
  padding: 4,
}

const badgeStyle: React.CSSProperties = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: 'var(--text-faint)',
  background: 'var(--bg-subtle)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  padding: '1px 5px',
}
