'use client'

// The collapsible VIEWS panel for the current table. "Create new…" at top (creates a grid
// view via the API), a "Find a view" search box, then the view list with a grid icon; the
// active view is highlighted. Switching a view loads its config (handled by the parent).
import { useState } from 'react'
import type { EngineView } from '@retentionos/engine'
import { GridIcon, PlusIcon, SearchIcon, TrashIcon } from './icons'

export function ViewsPanel({
  views,
  activeViewId,
  onSwitch,
  onCreate,
  onDelete,
}: {
  views: EngineView[]
  activeViewId: string | null
  onSwitch: (view: EngineView) => void
  onCreate: (name: string) => void
  onDelete: (view: EngineView) => void
}) {
  const [query, setQuery] = useState('')
  const filtered = views.filter((v) => v.name.toLowerCase().includes(query.toLowerCase()))

  function create() {
    const n = views.length + 1
    onCreate(`Grid ${n}`)
  }

  return (
    <aside
      style={{
        width: 'var(--views-w)',
        flexShrink: 0,
        borderRight: '1px solid var(--border)',
        background: 'var(--bg-sidebar)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <button
        onClick={create}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          margin: 10,
          padding: '8px 10px',
          border: '1px solid var(--border-strong)',
          borderRadius: 6,
          background: 'var(--bg)',
          color: 'var(--text)',
          fontWeight: 500,
        }}
      >
        <PlusIcon size={14} />
        Create new…
      </button>

      <div style={{ padding: '0 10px 8px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 8px',
            border: '1px solid var(--border)',
            borderRadius: 6,
            background: 'var(--bg)',
            color: 'var(--text-faint)',
          }}
        >
          <SearchIcon size={13} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a view"
            style={{ border: 'none', outline: 'none', background: 'transparent', flex: 1, color: 'var(--text)' }}
          />
        </div>
      </div>

      <nav style={{ overflowY: 'auto', flex: 1, padding: '0 6px 10px' }}>
        {filtered.length === 0 ? (
          <p style={{ color: 'var(--text-faint)', fontSize: 12, padding: '4px 8px' }}>No views.</p>
        ) : (
          filtered.map((v) => {
            const active = v.id === activeViewId
            return (
              <div
                key={v.id}
                className="view-row"
                onClick={() => onSwitch(v)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 8px',
                  borderRadius: 6,
                  marginBottom: 1,
                  cursor: 'pointer',
                  background: active ? 'var(--accent-soft)' : 'transparent',
                  color: active ? 'var(--accent)' : 'var(--text)',
                  fontWeight: active ? 500 : 400,
                }}
              >
                <GridIcon size={14} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {v.name}
                </span>
                {views.length > 1 ? (
                  <button
                    className="view-del"
                    title="Delete view"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(v)
                    }}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--text-faint)',
                      display: 'none',
                      padding: 0,
                    }}
                  >
                    <TrashIcon size={13} />
                  </button>
                ) : null}
              </div>
            )
          })
        )}
      </nav>

      <style>{`
        .view-row:hover { background: var(--bg-hover); }
        .view-row:hover .view-del { display: flex !important; }
      `}</style>
    </aside>
  )
}
