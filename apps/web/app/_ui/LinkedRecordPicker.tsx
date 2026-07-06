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

  // Resolve the linked table's primary field (first by position) — the search column + label.
  useEffect(() => {
    let alive = true
    api
      .describeTable(linkedTableId)
      .then((desc) => {
        if (alive) setPrimaryFieldId(desc.fields[0]?.id ?? null)
      })
      .catch(() => {
        if (alive) setPrimaryFieldId(null)
      })
    return () => {
      alive = false
    }
  }, [linkedTableId])

  // Server-side search: debounced 250ms `contains` on the primary field, limit 25. An empty
  // query returns the first 25 by position. Replaces the old fetch-200-then-client-filter.
  useEffect(() => {
    if (primaryFieldId === null && query.trim()) return // wait until we know the search column
    let alive = true
    const q = query.trim()
    const handle = setTimeout(() => {
      api
        .queryRecords(linkedTableId, {
          limit: 25,
          filters: q && primaryFieldId ? [{ fieldId: primaryFieldId, op: 'contains', value: q }] : undefined,
        })
        .then((page) => {
          if (alive) setRecords(page.records)
        })
        .catch(() => {
          if (alive) setRecords([])
        })
    }, 250)
    return () => {
      alive = false
      clearTimeout(handle)
    }
  }, [linkedTableId, query, primaryFieldId])

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
  // Filtering is now server-side (contains on the primary field); render the page as-is.
  const filtered = records

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
