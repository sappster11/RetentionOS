'use client'

// The collapsible VIEWS panel for the current table. "Create new…" at top (creates a grid
// view via the API), a "Find a view" search box, then the view list with a grid icon; the
// active view is highlighted. Switching a view loads its config (handled by the parent).
import { useState } from 'react'
import type { EngineField, EngineView, ViewConfig, ViewType } from '@retentionos/engine'
import { GridIcon, KanbanIcon, PlusIcon, SearchIcon, TrashIcon } from './icons'

export function ViewsPanel({
  views,
  fields,
  activeViewId,
  onSwitch,
  onCreate,
  onDelete,
}: {
  views: EngineView[]
  fields: EngineField[]
  activeViewId: string | null
  onSwitch: (view: EngineView) => void
  onCreate: (name: string, type: ViewType, config?: ViewConfig) => void
  onDelete: (view: EngineView) => void
}) {
  const [query, setQuery] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [pendingKanban, setPendingKanban] = useState(false)

  const filtered = views.filter((v) => v.name.toLowerCase().includes(query.toLowerCase()))
  const selectFields = fields.filter((f) => f.type === 'single_select')

  function createGrid() {
    const n = views.filter((v) => v.type === 'grid').length + 1
    onCreate(`Grid ${n}`, 'grid')
    setMenuOpen(false)
  }
  function createKanban(groupByFieldId: string) {
    const n = views.filter((v) => v.type === 'kanban').length + 1
    onCreate(`Kanban ${n}`, 'kanban', { groupByFieldId })
    setMenuOpen(false)
    setPendingKanban(false)
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
      <div style={{ position: 'relative', margin: 10 }}>
        <button
          onClick={() => {
            setMenuOpen((v) => !v)
            setPendingKanban(false)
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '8px 10px',
            border: '1px solid var(--border-strong)',
            borderRadius: 6,
            background: 'var(--bg)',
            color: 'var(--text)',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          <PlusIcon size={14} />
          Create new…
        </button>
        {menuOpen ? (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              marginTop: 4,
              zIndex: 30,
              background: 'var(--bg)',
              border: '1px solid var(--border-strong)',
              borderRadius: 8,
              boxShadow: '0 10px 30px rgba(0,0,0,0.16)',
              padding: 6,
            }}
          >
            {!pendingKanban ? (
              <>
                <button onClick={createGrid} style={menuItem}>
                  <GridIcon size={14} /> Grid
                </button>
                <button
                  onClick={() => {
                    if (selectFields.length === 0) return
                    setPendingKanban(true)
                  }}
                  disabled={selectFields.length === 0}
                  title={selectFields.length === 0 ? 'Add a single-select field first' : undefined}
                  style={{ ...menuItem, color: selectFields.length === 0 ? 'var(--text-faint)' : 'var(--text)', cursor: selectFields.length === 0 ? 'not-allowed' : 'pointer' }}
                >
                  <KanbanIcon size={14} /> Kanban
                </button>
              </>
            ) : (
              <div style={{ padding: 4 }}>
                <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 6 }}>Group by</div>
                {selectFields.map((f) => (
                  <button key={f.id} onClick={() => createKanban(f.id)} style={menuItem}>
                    {f.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>

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
                {v.type === 'kanban' ? <KanbanIcon size={14} /> : <GridIcon size={14} />}
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

const menuItem: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  textAlign: 'left',
  padding: '7px 8px',
  border: 'none',
  background: 'transparent',
  color: 'var(--text)',
  borderRadius: 5,
  fontSize: 13,
  cursor: 'pointer',
}
