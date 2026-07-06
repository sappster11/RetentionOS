// Thin browser fetch wrapper over the /api/v1 REST surface. The UI talks to the API (not
// the engine service layer directly), so the API is exercised by the app itself.
import type {
  EngineBase,
  EngineField,
  EngineRecordRevision,
  EngineTable,
  EngineView,
  EnrichedRecord,
  FieldOptions,
  FieldType,
  FilterCondition,
  QueryRecordsResult,
  SortSpec,
  TableDescriptor,
  ViewConfig,
  ViewType,
} from '@retentionos/engine'

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    throw new Error((data.error as string) ?? `Request failed (${res.status})`)
  }
  return data as T
}

export const api = {
  listBases: () => req<{ bases: EngineBase[] }>('/api/v1/bases').then((r) => r.bases),

  createBase: (body: { name: string; icon?: string | null }) =>
    req<{ base: EngineBase }>('/api/v1/bases', {
      method: 'POST',
      body: JSON.stringify(body),
    }).then((r) => r.base),

  updateBase: (baseId: string, patch: { name?: string; icon?: string | null; position?: number }) =>
    req<{ base: EngineBase }>(`/api/v1/bases/${baseId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }).then((r) => r.base),

  deleteBase: (baseId: string) => req<{ ok: true }>(`/api/v1/bases/${baseId}`, { method: 'DELETE' }),

  listTables: () => req<{ tables: EngineTable[] }>('/api/v1/tables').then((r) => r.tables),

  createTable: (body: {
    name: string
    icon?: string | null
    description?: string | null
    baseId?: string | null
  }) =>
    req<{ table: EngineTable }>('/api/v1/tables', {
      method: 'POST',
      body: JSON.stringify(body),
    }).then((r) => r.table),

  describeTable: (tableId: string) => req<TableDescriptor>(`/api/v1/tables/${tableId}`),

  deleteTable: (tableId: string) =>
    req<{ ok: true }>(`/api/v1/tables/${tableId}`, { method: 'DELETE' }),

  createField: (
    tableId: string,
    body: { name: string; type: FieldType; options?: FieldOptions; required?: boolean },
  ) =>
    req<{ field: EngineField }>(`/api/v1/tables/${tableId}/fields`, {
      method: 'POST',
      body: JSON.stringify(body),
    }).then((r) => r.field),

  deleteField: (tableId: string, fieldId: string) =>
    req<{ ok: true }>(`/api/v1/tables/${tableId}/fields/${fieldId}`, { method: 'DELETE' }),

  queryRecords: (
    tableId: string,
    params?: { limit?: number; offset?: number; sorts?: SortSpec[]; filters?: FilterCondition[] },
  ) => {
    const q = new URLSearchParams()
    if (params?.limit) q.set('limit', String(params.limit))
    if (params?.offset) q.set('offset', String(params.offset))
    // Sort/filter wire format matches the records route: <fieldId>:asc|desc and
    // <fieldId>:<op>[:<value>]. Repeatable params.
    for (const s of params?.sorts ?? []) q.append('sort', `${s.fieldId}:${s.direction}`)
    for (const f of params?.filters ?? []) {
      const noValue = f.op === 'is_empty' || f.op === 'is_not_empty'
      q.append('filter', noValue ? `${f.fieldId}:${f.op}` : `${f.fieldId}:${f.op}:${String(f.value ?? '')}`)
    }
    const qs = q.toString()
    return req<QueryRecordsResult>(`/api/v1/tables/${tableId}/records${qs ? `?${qs}` : ''}`)
  },

  getRecord: (tableId: string, recordId: string) =>
    req<{ record: EnrichedRecord }>(`/api/v1/tables/${tableId}/records/${recordId}`).then((r) => r.record),

  createRecord: (tableId: string, values: Record<string, unknown>) =>
    req<{ record: EnrichedRecord }>(`/api/v1/tables/${tableId}/records`, {
      method: 'POST',
      body: JSON.stringify({ values }),
    }).then((r) => r.record),

  updateRecord: (tableId: string, recordId: string, values: Record<string, unknown>) =>
    req<{ record: EnrichedRecord }>(`/api/v1/tables/${tableId}/records/${recordId}`, {
      method: 'PATCH',
      body: JSON.stringify({ values }),
    }).then((r) => r.record),

  deleteRecord: (tableId: string, recordId: string) =>
    req<{ deleted: number }>(`/api/v1/tables/${tableId}/records/${recordId}`, {
      method: 'DELETE',
    }),

  listRevisions: (tableId: string, recordId: string) =>
    req<{ revisions: EngineRecordRevision[] }>(
      `/api/v1/tables/${tableId}/records/${recordId}/revisions`,
    ).then((r) => r.revisions),

  bulkDeleteRecords: (tableId: string, recordIds: string[]) =>
    req<{ deleted: number }>(`/api/v1/tables/${tableId}/records/bulk-delete`, {
      method: 'POST',
      body: JSON.stringify({ recordIds }),
    }),

  listViews: (tableId: string) =>
    req<{ views: EngineView[] }>(`/api/v1/tables/${tableId}/views`).then((r) => r.views),

  createView: (tableId: string, body: { name: string; type?: 'grid' | 'kanban'; config?: ViewConfig }) =>
    req<{ view: EngineView }>(`/api/v1/tables/${tableId}/views`, {
      method: 'POST',
      body: JSON.stringify(body),
    }).then((r) => r.view),

  updateView: (tableId: string, viewId: string, patch: { name?: string; config?: ViewConfig }) =>
    req<{ view: EngineView }>(`/api/v1/tables/${tableId}/views/${viewId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }).then((r) => r.view),

  deleteView: (tableId: string, viewId: string) =>
    req<{ ok: true }>(`/api/v1/tables/${tableId}/views/${viewId}`, { method: 'DELETE' }),
}
