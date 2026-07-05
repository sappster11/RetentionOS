'use client'

// The grid toolbar. Left: views-panel toggle + current view name. Right: Hide fields,
// Filter, Sort (all LIVE — persisted to the view config and applied via the records API),
// then Group / Color / row-height (DISABLED with a "soon" tooltip), then search (client
// side highlight/jump within loaded records).
import { useEffect, useRef, useState } from 'react'
import type { EngineField, FilterCondition, SortSpec } from '@retentionos/engine'
import { FIELD_TYPE_LABELS } from './AddFieldPopover'
import {
  ChevronDownIcon,
  ColorIcon,
  EyeOffIcon,
  FilterIcon,
  GridIcon,
  GroupIcon,
  RowHeightIcon,
  SearchIcon,
  SidebarIcon,
  SortIcon,
} from './icons'
import { FieldIcon } from './icons'

type PopId = 'hide' | 'sort' | 'filter' | 'search' | null

const FILTER_OPS: { op: FilterCondition['op']; label: string; noValue?: boolean }[] = [
  { op: 'contains', label: 'contains' },
  { op: 'eq', label: 'is' },
  { op: 'neq', label: 'is not' },
  { op: 'gt', label: '>' },
  { op: 'gte', label: '≥' },
  { op: 'lt', label: '<' },
  { op: 'lte', label: '≤' },
  { op: 'is_empty', label: 'is empty', noValue: true },
  { op: 'is_not_empty', label: 'is not empty', noValue: true },
]

export function Toolbar({
  viewName,
  viewsOpen,
  onToggleViews,
  fields,
  visibleFieldIds,
  onSetVisibleFieldIds,
  sorts,
  onSetSorts,
  filters,
  onSetFilters,
  search,
  onSearch,
  hasActiveView,
}: {
  viewName: string
  viewsOpen: boolean
  onToggleViews: () => void
  fields: EngineField[]
  visibleFieldIds: string[] | undefined
  onSetVisibleFieldIds: (next: string[] | undefined) => void
  sorts: SortSpec[]
  onSetSorts: (next: SortSpec[]) => void
  filters: FilterCondition[]
  onSetFilters: (next: FilterCondition[]) => void
  search: string
  onSearch: (q: string) => void
  hasActiveView: boolean
}) {
  const [pop, setPop] = useState<PopId>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Close popover on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setPop(null)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const hiddenCount = visibleFieldIds ? fields.length - visibleFieldIds.length : 0
  const sortCount = sorts.length
  const filterCount = filters.length

  return (
    <div
      ref={wrapRef}
      style={{
        height: 'var(--toolbar-h)',
        flexShrink: 0,
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg)',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '0 10px',
      }}
    >
      <TbBtn onClick={onToggleViews} active={viewsOpen} title="Toggle views">
        <SidebarIcon size={15} />
      </TbBtn>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 13, padding: '0 6px' }}>
        <GridIcon size={15} />
        {viewName}
      </span>

      <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />

      {/* Hide fields */}
      <div style={{ position: 'relative' }}>
        <TbBtn
          onClick={() => setPop((p) => (p === 'hide' ? null : 'hide'))}
          active={pop === 'hide' || hiddenCount > 0}
          disabled={!hasActiveView}
        >
          <EyeOffIcon size={14} />
          <span>{hiddenCount > 0 ? `${hiddenCount} hidden` : 'Hide fields'}</span>
        </TbBtn>
        {pop === 'hide' ? (
          <HideFieldsPopover
            fields={fields}
            visibleFieldIds={visibleFieldIds}
            onSetVisibleFieldIds={onSetVisibleFieldIds}
          />
        ) : null}
      </div>

      {/* Filter */}
      <div style={{ position: 'relative' }}>
        <TbBtn
          onClick={() => setPop((p) => (p === 'filter' ? null : 'filter'))}
          active={pop === 'filter' || filterCount > 0}
          disabled={!hasActiveView}
        >
          <FilterIcon size={14} />
          <span>{filterCount > 0 ? `Filter (${filterCount})` : 'Filter'}</span>
        </TbBtn>
        {pop === 'filter' ? (
          <FilterPopover fields={fields} filters={filters} onSetFilters={onSetFilters} />
        ) : null}
      </div>

      {/* Sort */}
      <div style={{ position: 'relative' }}>
        <TbBtn
          onClick={() => setPop((p) => (p === 'sort' ? null : 'sort'))}
          active={pop === 'sort' || sortCount > 0}
          disabled={!hasActiveView}
        >
          <SortIcon size={14} />
          <span>{sortCount > 0 ? `Sorted` : 'Sort'}</span>
        </TbBtn>
        {pop === 'sort' ? <SortPopover fields={fields} sorts={sorts} onSetSorts={onSetSorts} /> : null}
      </div>

      {/* Disabled: Group / Color / row-height */}
      <TbBtn disabled title="Grouping is coming soon">
        <GroupIcon size={14} />
        <span>Group</span>
      </TbBtn>
      <TbBtn disabled title="Coloring is coming soon">
        <ColorIcon size={14} />
        <span>Color</span>
      </TbBtn>
      <TbBtn disabled title="Row height is coming soon" iconOnly>
        <RowHeightIcon size={15} />
      </TbBtn>

      <div style={{ flex: 1 }} />

      {/* Search */}
      <div style={{ position: 'relative' }}>
        <TbBtn onClick={() => setPop((p) => (p === 'search' ? null : 'search'))} active={pop === 'search' || !!search} iconOnly>
          <SearchIcon size={15} />
        </TbBtn>
        {pop === 'search' ? <SearchPopover search={search} onSearch={onSearch} /> : null}
      </div>
    </div>
  )
}

function TbBtn({
  children,
  onClick,
  active,
  disabled,
  title,
  iconOnly,
}: {
  children: React.ReactNode
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  title?: string
  iconOnly?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        height: 28,
        padding: iconOnly ? '0 7px' : '0 9px',
        border: 'none',
        borderRadius: 6,
        fontSize: 13,
        background: active ? 'var(--accent-soft)' : 'transparent',
        color: disabled ? 'var(--text-faint)' : active ? 'var(--accent)' : 'var(--text-muted)',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  )
}

const popStyle: React.CSSProperties = {
  position: 'absolute',
  top: 34,
  left: 0,
  zIndex: 40,
  minWidth: 260,
  background: 'var(--bg)',
  border: '1px solid var(--border-strong)',
  borderRadius: 8,
  boxShadow: '0 10px 30px rgba(0,0,0,0.16)',
  padding: 12,
}

// --- Hide fields ------------------------------------------------------------
function HideFieldsPopover({
  fields,
  visibleFieldIds,
  onSetVisibleFieldIds,
}: {
  fields: EngineField[]
  visibleFieldIds: string[] | undefined
  onSetVisibleFieldIds: (next: string[] | undefined) => void
}) {
  const visible = new Set(visibleFieldIds ?? fields.map((f) => f.id))

  function toggle(id: string, on: boolean) {
    const next = new Set(visible)
    if (on) next.add(id)
    else next.delete(id)
    // Preserve field order; undefined when everything is visible (keeps config clean).
    const ordered = fields.filter((f) => next.has(f.id)).map((f) => f.id)
    onSetVisibleFieldIds(ordered.length === fields.length ? undefined : ordered)
  }

  return (
    <div style={popStyle}>
      <div style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        Fields
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 300, overflowY: 'auto' }}>
        {fields.map((f) => (
          <label
            key={f.id}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px', cursor: 'pointer', borderRadius: 4 }}
          >
            <input type="checkbox" checked={visible.has(f.id)} onChange={(e) => toggle(f.id, e.target.checked)} />
            <span style={{ color: 'var(--text-faint)', display: 'flex' }}>
              <FieldIcon type={f.type} size={13} />
            </span>
            <span>{f.name}</span>
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
        <button style={miniLink} onClick={() => onSetVisibleFieldIds(undefined)}>
          Show all
        </button>
        <button style={miniLink} onClick={() => onSetVisibleFieldIds([])}>
          Hide all
        </button>
      </div>
    </div>
  )
}

// --- Sort -------------------------------------------------------------------
function SortPopover({
  fields,
  sorts,
  onSetSorts,
}: {
  fields: EngineField[]
  sorts: SortSpec[]
  onSetSorts: (next: SortSpec[]) => void
}) {
  // Single-field sort picker (per spec).
  const current = sorts[0]
  return (
    <div style={{ ...popStyle, minWidth: 300 }}>
      <div style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        Sort by
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <select
          value={current?.fieldId ?? ''}
          onChange={(e) => {
            const fieldId = e.target.value
            if (!fieldId) return onSetSorts([])
            onSetSorts([{ fieldId, direction: current?.direction ?? 'asc' }])
          }}
          style={{ ...selStyle, flex: 1 }}
        >
          <option value="">— none —</option>
          {fields.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <select
          value={current?.direction ?? 'asc'}
          disabled={!current}
          onChange={(e) =>
            current && onSetSorts([{ fieldId: current.fieldId, direction: e.target.value as 'asc' | 'desc' }])
          }
          style={{ ...selStyle, width: 130 }}
        >
          <option value="asc">A → Z</option>
          <option value="desc">Z → A</option>
        </select>
      </div>
      {current ? (
        <button style={{ ...miniLink, marginTop: 8 }} onClick={() => onSetSorts([])}>
          Remove sort
        </button>
      ) : null}
    </div>
  )
}

// --- Filter -----------------------------------------------------------------
function FilterPopover({
  fields,
  filters,
  onSetFilters,
}: {
  fields: EngineField[]
  filters: FilterCondition[]
  onSetFilters: (next: FilterCondition[]) => void
}) {
  function update(i: number, patch: Partial<FilterCondition>) {
    onSetFilters(filters.map((f, j) => (j === i ? { ...f, ...patch } : f)))
  }
  function remove(i: number) {
    onSetFilters(filters.filter((_, j) => j !== i))
  }
  function add() {
    const f0 = fields[0]
    if (!f0) return
    onSetFilters([...filters, { fieldId: f0.id, op: 'contains', value: '' }])
  }

  return (
    <div style={{ ...popStyle, minWidth: 420 }}>
      <div style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        Filters — records where all conditions match
      </div>
      {filters.length === 0 ? (
        <p style={{ color: 'var(--text-faint)', fontSize: 12, margin: '4px 0 10px' }}>No filters yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filters.map((f, i) => {
            const opDef = FILTER_OPS.find((o) => o.op === f.op)
            return (
              <div key={i} style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                <select value={f.fieldId} onChange={(e) => update(i, { fieldId: e.target.value })} style={{ ...selStyle, flex: 1 }}>
                  {fields.map((fl) => (
                    <option key={fl.id} value={fl.id}>
                      {fl.name}
                    </option>
                  ))}
                </select>
                <select
                  value={f.op}
                  onChange={(e) => update(i, { op: e.target.value as FilterCondition['op'] })}
                  style={{ ...selStyle, width: 120 }}
                >
                  {FILTER_OPS.map((o) => (
                    <option key={o.op} value={o.op}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {opDef?.noValue ? (
                  <span style={{ flex: 1 }} />
                ) : (
                  <input
                    value={String(f.value ?? '')}
                    onChange={(e) => update(i, { value: e.target.value })}
                    placeholder="value"
                    style={{ ...selStyle, flex: 1 }}
                  />
                )}
                <button onClick={() => remove(i)} style={{ ...miniLink, color: 'var(--danger)', padding: '0 6px' }}>
                  ×
                </button>
              </div>
            )
          })}
        </div>
      )}
      <button style={{ ...miniLink, marginTop: 10 }} onClick={add}>
        + Add condition
      </button>
    </div>
  )
}

// --- Search -----------------------------------------------------------------
function SearchPopover({ search, onSearch }: { search: string; onSearch: (q: string) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  return (
    <div style={{ ...popStyle, left: 'auto', right: 0, minWidth: 240, padding: 8 }}>
      <input
        ref={ref}
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Search records…"
        style={{ ...selStyle, width: '100%' }}
      />
    </div>
  )
}

const selStyle: React.CSSProperties = {
  padding: '5px 7px',
  border: '1px solid var(--border-strong)',
  borderRadius: 6,
  background: 'var(--bg)',
  color: 'var(--text)',
  outline: 'none',
}

const miniLink: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--accent)',
  fontSize: 12.5,
  padding: 0,
  cursor: 'pointer',
}
