// @retentionos/engine — the meta-schema service layer. The UI (via REST), n8n webhooks,
// and the MCP server are all clients of these functions (agent-parity law).

export * from './types'
export { coerceValue, coerceValues, validateFieldOptions, isFieldType } from './fieldTypes'
export {
  // tables
  createTable,
  updateTable,
  deleteTable,
  listTables,
  getTable,
  getTableBySlug,
  describeTable,
  // fields
  createField,
  updateField,
  deleteField,
  listFields,
  getField,
  // records
  createRecord,
  updateRecord,
  deleteRecords,
  getRecord,
  queryRecords,
  // views
  createView,
  updateView,
  deleteView,
  listViews,
  getView,
  // revisions
  listRecordRevisions,
} from './engine'
export type {
  CreateTableInput,
  UpdateTablePatch,
  CreateFieldInput,
  UpdateFieldPatch,
  CreateViewInput,
  UpdateViewPatch,
  QueryRecordsOptions,
  QueryRecordsResult,
} from './engine'
