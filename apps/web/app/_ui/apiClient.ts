// Thin browser fetch wrapper over the /api/v1 REST surface. The UI talks to the API (not
// the engine service layer directly), so the API is exercised by the app itself.
import type {
  EngineField,
  EngineRecord,
  EngineTable,
  EngineView,
  FieldOptions,
  FieldType,
  QueryRecordsResult,
  TableDescriptor,
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
  listTables: () => req<{ tables: EngineTable[] }>('/api/v1/tables').then((r) => r.tables),

  createTable: (body: { name: string; icon?: string | null; description?: string | null }) =>
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

  queryRecords: (tableId: string, params?: { limit?: number; offset?: number }) => {
    const q = new URLSearchParams()
    if (params?.limit) q.set('limit', String(params.limit))
    if (params?.offset) q.set('offset', String(params.offset))
    const qs = q.toString()
    return req<QueryRecordsResult>(`/api/v1/tables/${tableId}/records${qs ? `?${qs}` : ''}`)
  },

  createRecord: (tableId: string, values: Record<string, unknown>) =>
    req<{ record: EngineRecord }>(`/api/v1/tables/${tableId}/records`, {
      method: 'POST',
      body: JSON.stringify({ values }),
    }).then((r) => r.record),

  updateRecord: (tableId: string, recordId: string, values: Record<string, unknown>) =>
    req<{ record: EngineRecord }>(`/api/v1/tables/${tableId}/records/${recordId}`, {
      method: 'PATCH',
      body: JSON.stringify({ values }),
    }).then((r) => r.record),

  deleteRecord: (tableId: string, recordId: string) =>
    req<{ deleted: number }>(`/api/v1/tables/${tableId}/records/${recordId}`, {
      method: 'DELETE',
    }),

  listViews: (tableId: string) =>
    req<{ views: EngineView[] }>(`/api/v1/tables/${tableId}/views`).then((r) => r.views),
}
