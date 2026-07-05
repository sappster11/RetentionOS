'use client'

// A popover that searches records in a linked table so the user can pick one to link. The
// label shown is the target table's PRIMARY field (first field by position — the same rule
// the grid's frozen column and the engine's link display use).
import { useEffect, useMemo, useRef, useState } from 'react'
import type { EngineField, EnrichedRecord } from '@retentionos/engine'
import { api } from './apiClient'
import { SearchIcon } from './icons'

export function LinkedRecordPicker({
  linkedTableId,
  selectedIds,
  onPick,
  onClose,
}: {
  linkedTableId: string
  selectedIds: string[]
  onPick: (id: string) => void
  onClose: () => void
}) {
  const [primaryFieldId, setPrimaryFieldId] = useState<string | null>(null)
  const [records, setRecords] = useState<EnrichedRecord[]>([])
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    Promise.all([api.describeTable(linkedTableId), api.queryRecords(linkedTableId, { limit: 200 })])
      .then(([desc, page]) => {
        if (!alive) return
        setPrimaryFieldId(desc.fields[0]?.id ?? null)
        setRecords(page.records)
      })
      .catch(() => {
        if (alive) setRecords([])
      })
    return () => {
      alive = false
    }
  }, [linkedTableId])

  // Close on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [onClose])

  function label(rec: EnrichedRecord): string {
    if (!primaryFieldId) return 'Untitled'
    const v = rec.values[primaryFieldId]
    if (v == null || v === '') return 'Untitled'
    if (Array.isArray(v)) return v.length ? String(v[0]) : 'Untitled'
    return String(v)
  }

  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const q = query.trim().toLowerCase()
  const filtered = records.filter((r) => (q ? label(r).toLowerCase().includes(q) : true))

  return (
    <div ref={wrapRef} style={popStyle} onClick={(e) => e.stopPropagation()}>
      <div style={searchWrap}>
        <SearchIcon size={13} />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search records…"
          style={{ border: 'none', outline: 'none', background: 'transparent', flex: 1, color: 'var(--text)', fontSize: 13 }}
        />
      </div>
      <div style={{ maxHeight: 260, overflowY: 'auto', marginTop: 6 }}>
        {filtered.length === 0 ? (
          <p style={{ color: 'var(--text-faint)', fontSize: 12, padding: '6px 8px' }}>No records.</p>
        ) : (
          filtered.map((r) => {
            const isSel = selected.has(r.id)
            return (
              <button
                key={r.id}
                onClick={() => !isSel && onPick(r.id)}
                disabled={isSel}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  textAlign: 'left',
                  border: 'none',
                  background: 'transparent',
                  padding: '6px 8px',
                  borderRadius: 5,
                  color: isSel ? 'var(--text-faint)' : 'var(--text)',
                  cursor: isSel ? 'default' : 'pointer',
                  fontSize: 13,
                }}
                className="lrp-row"
              >
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {label(r)}
                </span>
                {isSel ? <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>linked</span> : null}
              </button>
            )
          })
        )}
      </div>
      <style>{`.lrp-row:not(:disabled):hover { background: var(--bg-hover); }`}</style>
    </div>
  )
}

const popStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  marginTop: 4,
  zIndex: 50,
  minWidth: 260,
  maxWidth: 320,
  background: 'var(--bg)',
  border: '1px solid var(--border-strong)',
  borderRadius: 8,
  boxShadow: '0 10px 30px rgba(0,0,0,0.16)',
  padding: 8,
}

const searchWrap: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 8px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text-faint)',
}
