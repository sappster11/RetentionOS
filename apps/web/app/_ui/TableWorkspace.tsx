'use client'

// The per-table workspace: a collapsible VIEWS panel (left), a TOOLBAR (view name + Hide
// fields / Filter / Sort / search + disabled Group/Color/row-height), and the GRID.
//
// View state — visibleFieldIds, sorts, filters — lives on the active engine_view's config
// and is PERSISTED through the views REST API (agent-parity law: no view logic that only
// lives in client state). We keep optimistic local copies but always write through, and we
// re-query records from the records API whenever sorts/filters change so ?sort= / ?filter=
// do the work server-side.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  EngineField,
  EngineRecord,
  EngineTable,
  EngineView,
  FieldOptions,
  FieldType,
  FilterCondition,
  SortSpec,
  ViewConfig,
} from '@retentionos/engine'
import { api } from './apiClient'
import { Grid } from './Grid'
import { ViewsPanel } from './ViewsPanel'
import { Toolbar } from './Toolbar'

export function TableWorkspace({
  table,
  initialFields,
  initialViews,
  initialRecords,
  initialTotal,
}: {
  table: EngineTable
  initialFields: EngineField[]
  initialViews: EngineView[]
  initialRecords: EngineRecord[]
  initialTotal: number
}) {
  const [fields, setFields] = useState<EngineField[]>(initialFields)
  const [records, setRecords] = useState<EngineRecord[]>(initialRecords)
  const [total, setTotal] = useState(initialTotal)
  const [views, setViews] = useState<EngineView[]>(initialViews)
  const [activeViewId, setActiveViewId] = useState<string | null>(initialViews[0]?.id ?? null)
  const [viewsOpen, setViewsOpen] = useState(true)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)

  const activeView = useMemo(
    () => views.find((v) => v.id === activeViewId) ?? null,
    [views, activeViewId],
  )
  const config: ViewConfig = activeView?.config ?? {}
  const sorts = config.sorts ?? []
  const filters = config.filters ?? []

  // Field visibility: a view with no visibleFieldIds shows all fields, in field order.
  const visibleFieldIds = config.visibleFieldIds
  const visibleFields = useMemo(() => {
    if (!visibleFieldIds) return fields
    const set = new Set(visibleFieldIds)
    return fields.filter((f) => set.has(f.id))
  }, [fields, visibleFieldIds])

  // --- Records reload when sorts/filters change (server-side via ?sort=/?filter=). -------
  const reload = useCallback(
    async (nextSorts: SortSpec[], nextFilters: FilterCondition[]) => {
      setError(null)
      try {
        const page = await api.queryRecords(table.id, {
          limit: 200,
          sorts: nextSorts,
          filters: nextFilters,
        })
        setRecords(page.records)
        setTotal(page.total)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load records.')
      }
    },
    [table.id],
  )

  // --- Persist a config patch to the active view (write-through), optimistic locally. -----
  const patchViewConfig = useCallback(
    async (patch: Partial<ViewConfig>) => {
      if (!activeView) return
      const nextConfig: ViewConfig = { ...activeView.config, ...patch }
      setViews((vs) => vs.map((v) => (v.id === activeView.id ? { ...v, config: nextConfig } : v)))
      try {
        const saved = await api.updateView(table.id, activeView.id, { config: nextConfig })
        setViews((vs) => vs.map((v) => (v.id === saved.id ? saved : v)))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save view.')
      }
    },
    [activeView, table.id],
  )

  // --- Toolbar actions --------------------------------------------------------------------
  const setSorts = useCallback(
    async (next: SortSpec[]) => {
      await patchViewConfig({ sorts: next })
      await reload(next, filters)
    },
    [patchViewConfig, reload, filters],
  )

  const setFilters = useCallback(
    async (next: FilterCondition[]) => {
      await patchViewConfig({ filters: next })
      await reload(sorts, next)
    },
    [patchViewConfig, reload, sorts],
  )

  const setVisibleFieldIds = useCallback(
    async (next: string[] | undefined) => {
      await patchViewConfig({ visibleFieldIds: next })
    },
    [patchViewConfig],
  )

  // --- Views: create / switch / delete ----------------------------------------------------
  const switchView = useCallback(
    async (view: EngineView) => {
      setActiveViewId(view.id)
      setSearch('')
      await reload(view.config.sorts ?? [], view.config.filters ?? [])
    },
    [reload],
  )

  const createView = useCallback(
    async (name: string) => {
      try {
        const view = await api.createView(table.id, { name, type: 'grid' })
        setViews((vs) => [...vs, view])
        setActiveViewId(view.id)
        setSearch('')
        await reload([], [])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create view.')
      }
    },
    [table.id, reload],
  )

  const deleteView = useCallback(
    async (view: EngineView) => {
      if (views.length <= 1) return // keep at least one view
      const prev = views
      const remaining = views.filter((v) => v.id !== view.id)
      setViews(remaining)
      if (activeViewId === view.id) {
        const next = remaining[0]!
        setActiveViewId(next.id)
        await reload(next.config.sorts ?? [], next.config.filters ?? [])
      }
      try {
        await api.deleteView(table.id, view.id)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete view.')
        setViews(prev)
      }
    },
    [views, activeViewId, table.id, reload],
  )

  // --- Record mutations (used by the grid) ------------------------------------------------
  const commitCell = useCallback(
    async (record: EngineRecord, field: EngineField, raw: unknown) => {
      setError(null)
      setRecords((rs) =>
        rs.map((r) => (r.id === record.id ? { ...r, values: { ...r.values, [field.id]: raw } } : r)),
      )
      try {
        const updated = await api.updateRecord(table.id, record.id, { [field.id]: raw })
        setRecords((rs) => rs.map((r) => (r.id === updated.id ? updated : r)))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Update failed.')
        await reload(sorts, filters)
      }
    },
    [table.id, reload, sorts, filters],
  )

  const addRow = useCallback(async () => {
    setError(null)
    try {
      const rec = await api.createRecord(table.id, {})
      setRecords((rs) => [...rs, rec])
      setTotal((t) => t + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add row.')
    }
  }, [table.id])

  const bulkDelete = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return
      setError(null)
      const prev = records
      const idSet = new Set(ids)
      setRecords((rs) => rs.filter((r) => !idSet.has(r.id)))
      setTotal((t) => Math.max(0, t - ids.length))
      try {
        await api.bulkDeleteRecords(table.id, ids)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Delete failed.')
        setRecords(prev)
        setTotal(prev.length)
      }
    },
    [records, table.id],
  )

  const addField = useCallback(
    async (input: { name: string; type: FieldType; options?: FieldOptions; required?: boolean }) => {
      const field = await api.createField(table.id, input)
      setFields((fs) => [...fs, field])
      // A view that hides fields must explicitly include the newborn so it stays visible.
      if (visibleFieldIds) await setVisibleFieldIds([...visibleFieldIds, field.id])
    },
    [table.id, visibleFieldIds, setVisibleFieldIds],
  )

  // Records the grid should render (search is client-side highlight/jump — see Grid).
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
      <Toolbar
        viewName={activeView?.name ?? 'Grid view'}
        viewsOpen={viewsOpen}
        onToggleViews={() => setViewsOpen((v) => !v)}
        fields={fields}
        visibleFieldIds={visibleFieldIds}
        onSetVisibleFieldIds={setVisibleFieldIds}
        sorts={sorts}
        onSetSorts={setSorts}
        filters={filters}
        onSetFilters={setFilters}
        search={search}
        onSearch={setSearch}
        hasActiveView={!!activeView}
      />

      {error ? (
        <div style={{ padding: '6px 16px', color: 'var(--danger)', fontSize: 12 }}>{error}</div>
      ) : null}

      <div style={{ flex: 1, display: 'flex', minHeight: 0, minWidth: 0 }}>
        {viewsOpen ? (
          <ViewsPanel
            views={views}
            activeViewId={activeViewId}
            onSwitch={switchView}
            onCreate={createView}
            onDelete={deleteView}
          />
        ) : null}

        <Grid
          table={table}
          fields={visibleFields}
          records={records}
          total={total}
          search={search}
          onCommitCell={commitCell}
          onAddRow={addRow}
          onBulkDelete={bulkDelete}
          onAddField={addField}
        />
      </div>
    </div>
  )
}
