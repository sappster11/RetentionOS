// @retentionos/engine — the meta-schema service layer. The UI (via REST), n8n webhooks,
// and the MCP server are all clients of these functions (agent-parity law).

export * from './types'
export { coerceValue, coerceValues, validateFieldOptions, isFieldType } from './fieldTypes'
export {
  // bases
  createBase,
  updateBase,
  deleteBase,
  listBases,
  getBase,
  getBaseBySlug,
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
  getRecordEnriched,
  queryRecords,
  // views
  createView,
  updateView,
  deleteView,
  listViews,
  getView,
  // forms
  isFormWritableType,
  getFormBySlug,
  submitForm,
  // revisions
  listRecordRevisions,
} from './engine'
export { convertLead } from './convert'
export type { ConvertLeadResult } from './convert'
export {
  // agent conversations (chat-panel persistence)
  createConversation,
  listConversations,
  getConversation,
  appendMessages,
  deleteConversation,
  CONVERSATION_TITLE_MAX,
} from './conversations'
export type {
  AgentConversation,
  AgentMessage,
  AgentMessageInput,
  AgentMessagePart,
  AgentMessageRole,
  ConversationWithMessages,
} from './conversations'
export type {
  FormField,
  FormDescriptor,
  CreateBaseInput,
  UpdateBasePatch,
  CreateTableInput,
  UpdateTablePatch,
  CreateFieldInput,
  UpdateFieldPatch,
  CreateViewInput,
  UpdateViewPatch,
  QueryRecordsOptions,
  QueryRecordsResult,
} from './engine'
