// @retentionos/db — the shared data-access layer over the owned Postgres.
// One layer, consumed by both apps/web and the MCP servers.

export { getPool, query, queryOne } from './pool'
export { slugify } from './util'
export * from './types'
export * from './orgs'
export * from './clients'
export * from './contacts'
export * from './channels'
export * from './documents'
export * from './activities'
export * from './clientData'
