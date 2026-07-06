// Engine MCP tool definitions — thin wrappers over @retentionos/engine (agent-parity
// law: this is the SAME service layer the web UI and REST API call; the server adds no
// logic of its own). Each tool is defined as data (name, schema, handler) so tests can
// invoke handlers directly without a stdio transport, and server.ts registers the same
// definitions onto an McpServer.
//
// Tenant-safety: this server talks to Postgres directly (no RLS), so every tool resolves
// its organization via resolveOrg() before touching the engine — same pattern as the
// parked domain servers.

import { getDefaultOrganization } from '@retentionos/db'
import {
  EngineError,
  FIELD_TYPES,
  createBase as engineCreateBase,
  createField as engineCreateField,
  createRecord as engineCreateRecord,
  createTable as engineCreateTable,
  createView as engineCreateView,
  deleteField as engineDeleteField,
  deleteRecords as engineDeleteRecords,
  deleteTable as engineDeleteTable,
  deleteView as engineDeleteView,
  describeTable as engineDescribeTable,
  getBase,
  getBaseBySlug,
  getRecordEnriched,
  getTable,
  getTableBySlug,
  listBases as engineListBases,
  listRecordRevisions,
  listTables as engineListTables,
  listViews as engineListViews,
  queryRecords as engineQueryRecords,
  updateField as engineUpdateField,
  updateRecord as engineUpdateRecord,
  updateTable as engineUpdateTable,
  updateView as engineUpdateView,
} from '@retentionos/engine'
import type {
  Actor,
  FieldOptions,
  FieldType,
  FilterCondition,
  SortSpec,
  ViewConfig,
  ViewType,
} from '@retentionos/engine'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Actor, org, and table resolution
// ---------------------------------------------------------------------------

/** Every mutation is attributed to an agent actor in the audit trail. ROS_AGENT_ID lets
 * different agents (e.g. "claude-desktop" vs an n8n bot) stay distinguishable. Read at
 * call time so the env can be set per-process without import-order concerns. */
export function agentActor(): Actor {
  return { type: 'agent', id: process.env.ROS_AGENT_ID || 'mcp-engine' }
}

/** Optional per-call context for embedded consumers (e.g. the in-app agent route), which
 * serve many concurrent requests from one process and therefore can't use the env-var
 * knobs (ROS_AGENT_ID / RETENTIONOS_ORG_ID) the stdio server relies on. */
export interface ToolRunContext {
  /** Actor stamped on mutations. Default: agentActor() (ROS_AGENT_ID env). */
  actor?: Actor
  /** Pre-resolved organization id. Behaves exactly like the RETENTIONOS_ORG_ID pin:
   * a conflicting per-call organization_id argument is rejected. */
  orgId?: string
}

/** What handlers receive alongside their parsed args: the resolved actor and an org
 * resolver with any per-call pin already baked in. */
interface HandlerContext {
  actor: Actor
  resolveOrg: (inputOrgId?: string) => Promise<string>
}

/** Org pinning: when a per-call orgId (embedded consumers) or RETENTIONOS_ORG_ID (stdio
 * server) is set, the call is locked to that tenant — a per-call organization_id that
 * differs is REJECTED (there is no per-call auth, so the pin is the only tenant boundary).
 * When unset: per-call override → the first (only, in dev) organization in the database.
 * Env is read at call time so tests can set it per-case. */
async function resolveOrg(inputOrgId?: string, pinnedOrgId?: string): Promise<string> {
  const pinned = pinnedOrgId || process.env.RETENTIONOS_ORG_ID
  if (pinned) {
    if (inputOrgId && inputOrgId !== pinned) {
      throw new EngineError(
        `This agent is pinned to org ${pinned}; ` +
          `a different per-call organization_id is not allowed.`,
        'forbidden',
      )
    }
    return pinned
  }
  if (inputOrgId) return inputOrgId
  const org = await getDefaultOrganization()
  if (org?.id) return org.id
  throw new EngineError(
    'No organization_id provided, RETENTIONOS_ORG_ID is not set, and no organization exists.',
    'no_org',
  )
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Accept a table reference as id (uuid), slug, or exact name (case-insensitive). */
async function resolveTableId(orgId: string, ref: string): Promise<string> {
  if (UUID_RE.test(ref)) {
    const byId = await getTable(orgId, ref)
    if (byId) return byId.id
  }
  const bySlug = await getTableBySlug(orgId, ref)
  if (bySlug) return bySlug.id
  const all = await engineListTables(orgId)
  const lowered = ref.toLowerCase()
  const byName = all.filter((t) => t.name.toLowerCase() === lowered)
  if (byName.length === 1) return byName[0]!.id
  if (byName.length > 1) {
    const matches = byName.map((t) => `${t.id} ("${t.name}")`).join(', ')
    throw new EngineError(
      `Multiple tables match "${ref}"; use the table id. Matches: ${matches}`,
      'ambiguous',
    )
  }
  throw new EngineError(
    `No table matching "${ref}" (tried id, slug, and name). Call list_tables to see what exists.`,
    'not_found',
  )
}

/** Accept a base reference as id (uuid), slug, or exact name (case-insensitive). */
async function resolveBaseId(orgId: string, ref: string): Promise<string> {
  if (UUID_RE.test(ref)) {
    const byId = await getBase(orgId, ref)
    if (byId) return byId.id
  }
  const bySlug = await getBaseBySlug(orgId, ref)
  if (bySlug) return bySlug.id
  const all = await engineListBases(orgId)
  const lowered = ref.toLowerCase()
  const byName = all.filter((b) => b.name.toLowerCase() === lowered)
  if (byName.length === 1) return byName[0]!.id
  if (byName.length > 1) {
    const matches = byName.map((b) => `${b.id} ("${b.name}")`).join(', ')
    throw new EngineError(
      `Multiple bases match "${ref}"; use the base id. Matches: ${matches}`,
      'ambiguous',
    )
  }
  throw new EngineError(
    `No base matching "${ref}" (tried id, slug, and name). Call list_bases to see what exists.`,
    'not_found',
  )
}

// ---------------------------------------------------------------------------
// Result plumbing
// ---------------------------------------------------------------------------

/** Matches the MCP CallToolResult shape without importing SDK types (keeps this module
 * transport-free so unit tests can import it with zero stdio machinery). */
export interface ToolResult {
  [key: string]: unknown
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

function ok(result: unknown): ToolResult {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
}

/** EngineError codes pass through intact ({"error":{code,message}}), so an agent can
 * distinguish not_found from bad_value from required and self-correct. Zod validation
 * failures map to "bad_input" with a readable per-path summary. */
function fail(error: unknown): ToolResult {
  if (error instanceof z.ZodError) {
    const message =
      'Invalid arguments: ' +
      error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')
    return {
      isError: true,
      content: [
        { type: 'text' as const, text: JSON.stringify({ error: { code: 'bad_input', message } }) },
      ],
    }
  }
  const code = error instanceof EngineError ? error.code : 'error'
  const message = error instanceof Error ? error.message : String(error)
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify({ error: { code, message } }) }],
  }
}

export interface EngineToolDef {
  name: string
  title: string
  description: string
  inputSchema: z.ZodRawShape
  /** Wrapped handler: args are validated against inputSchema here (so the tools array is
   * transport-independent) and engine errors are already mapped to MCP tool errors.
   * `ctx` lets an embedded consumer pin the org and set the audit actor per call. */
  run: (args: Record<string, unknown>, ctx?: ToolRunContext) => Promise<ToolResult>
}

function defineTool<S extends z.ZodRawShape>(def: {
  name: string
  title: string
  description: string
  inputSchema: S
  handler: (args: z.infer<z.ZodObject<S>>, ctx: HandlerContext) => Promise<unknown>
}): EngineToolDef {
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    inputSchema: def.inputSchema,
    run: async (args, runCtx) => {
      try {
        const parsed = z.object(def.inputSchema).parse(args) as z.infer<z.ZodObject<S>>
        const ctx: HandlerContext = {
          actor: runCtx?.actor ?? agentActor(),
          resolveOrg: (inputOrgId) => resolveOrg(inputOrgId, runCtx?.orgId),
        }
        return ok(await def.handler(parsed, ctx))
      } catch (error) {
        return fail(error)
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Shared schema fragments
// ---------------------------------------------------------------------------

const organizationIdField = z
  .string()
  .uuid()
  .optional()
  .describe(
    'Organization to scope to. Defaults to the server RETENTIONOS_ORG_ID, then the first ' +
      'organization in the database. If the server is pinned via RETENTIONOS_ORG_ID, a ' +
      'different value here is rejected.',
  )

const tableRef = z
  .string()
  .min(1)
  .describe('The table, referenced by id (uuid), slug, or exact name (case-insensitive).')

const selectChoiceSchema = z.object({
  id: z.string().min(1).describe('Stable choice id — record values store THIS, not the name.'),
  name: z.string().min(1).describe('Display label.'),
  color: z.string().optional().describe('Display color, e.g. "blue" (defaults to "gray").'),
})

const fieldOptionsSchema = z
  .object({
    choices: selectChoiceSchema
      .array()
      .optional()
      .describe('single_select / multi_select: the allowed choices.'),
    currencySymbol: z.string().optional().describe('currency: display symbol, e.g. "$".'),
    precision: z.number().int().optional().describe('number/currency: display decimal places.'),
    linkedTableId: z
      .string()
      .uuid()
      .optional()
      .describe('linked_record: the target table id (self-links allowed).'),
    recordLinkFieldId: z
      .string()
      .uuid()
      .optional()
      .describe('lookup/rollup: the linked_record field ON THIS TABLE whose links to walk.'),
    targetFieldId: z
      .string()
      .uuid()
      .optional()
      .describe(
        'lookup/rollup: the concrete (non-computed) field on the linked table to pull or ' +
          'aggregate. Optional only for a "count" rollup.',
      ),
    aggregate: z
      .enum(['count', 'sum', 'avg', 'min', 'max', 'concat'])
      .optional()
      .describe('rollup: how to aggregate the collected values.'),
    expression: z
      .string()
      .optional()
      .describe(
        'formula: arithmetic over same-table number/currency/percent fields using ' +
          '{fld:FIELD_ID} tokens, numeric literals, + - * / and parentheses. ' +
          'Example: "{fld:<uuid-of-Amount>} * {fld:<uuid-of-Probability>}".',
      ),
  })
  // Passthrough: unknown option keys (e.g. options.description stashed by seeds) must
  // survive describe → update round-trips instead of being silently stripped.
  .passthrough()
  .describe('Type-specific field configuration.')

const VALUE_FORMATS =
  'Record values are keyed by FIELD ID (uuid from describe_table), never field name. ' +
  'Formats by type: text/long_text/url/email = string; number/currency = number; ' +
  'percent = number stored as a 0-1 FRACTION (0.25 means 25%; a "25%" string is also accepted); ' +
  'checkbox = boolean; date = "YYYY-MM-DD"; datetime = ISO 8601 string; ' +
  'single_select = one choice ID from the field\'s options.choices (the id, NOT the display name); ' +
  'multi_select = array of choice ids; attachment = array of {url, name?}; ' +
  'linked_record = array of record ids from the linked table (replaces the full link set). ' +
  'Computed fields (formula, lookup, rollup, autonumber, created_time, last_modified_time) are ' +
  'READ-ONLY — never include them in a write.'

const filterSchema = z.object({
  fieldId: z.string().uuid().describe('Field id to filter on (not computed/linked fields).'),
  op: z
    .enum(['eq', 'neq', 'contains', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty'])
    .describe('Comparison. "contains" is case-insensitive substring on text.'),
  value: z
    .unknown()
    .optional()
    .describe('Comparison value (omit for is_empty / is_not_empty). Use choice ids for selects.'),
})

const sortSchema = z.object({
  fieldId: z.string().uuid().describe('Field id to sort by (not computed/linked fields).'),
  direction: z.enum(['asc', 'desc']).describe('Sort direction.'),
})

const formFieldSchema = z
  .object({
    fieldId: z.string().describe('A form-writable field id on the table (no computed, no linked_record).'),
    required: z.boolean().optional().describe('Form-level required (independent of the engine field flag).'),
    label: z.string().optional().describe('Override the field name on the public form.'),
    helpText: z.string().optional().describe('Help text under the label.'),
  })
  .describe('One form field, in render order.')

const viewConfigSchema = z
  .object({
    filters: filterSchema.array().optional(),
    sorts: sortSchema.array().optional(),
    visibleFieldIds: z.array(z.string()).optional().describe('Field ids to show, in order.'),
    groupByFieldId: z
      .string()
      .nullable()
      .optional()
      .describe('Kanban: the single_select field that defines the columns.'),
    title: z.string().optional().describe('Form: heading on the public page (falls back to the view name).'),
    description: z.string().optional().describe('Form: description under the title.'),
    submitLabel: z.string().optional().describe('Form: submit button label (default "Submit").'),
    publicSlug: z
      .string()
      .optional()
      .describe('Form: url-safe public slug for /f/<slug>. Omit to auto-generate; immutable once set.'),
    fields: formFieldSchema.array().optional().describe('Form: the fields shown, in order.'),
  })
  .describe('View configuration (filters, sorts, visible fields, kanban grouping, form settings).')

const FIELD_TYPE_ENUM = z.enum(FIELD_TYPES as [FieldType, ...FieldType[]])

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const tools: EngineToolDef[] = [
  // --- bases ------------------------------------------------------------------
  defineTool({
    name: 'list_bases',
    title: 'List bases',
    description:
      'List every base (workspace grouping of tables, e.g. "Sales CRM" / "Client Hub") in ' +
      'the organization: id, name, slug, icon, position. Tables carry a base_id (null = ' +
      'ungrouped "Workspace"); filter list_tables by base to see one base\'s tables.',
    inputSchema: { organization_id: organizationIdField },
    handler: async ({ organization_id }, ctx) => {
      const orgId = await ctx.resolveOrg(organization_id)
      return { bases: await engineListBases(orgId) }
    },
  }),

  defineTool({
    name: 'create_base',
    title: 'Create base',
    description:
      'Create a new empty base (workspace grouping of tables). Only name is required; a ' +
      'url-safe slug is derived (uniqued with -2, -3… on collision). Put tables in it via ' +
      'create_table\'s `base` argument.',
    inputSchema: {
      name: z.string().min(1).describe('Human-readable base name, e.g. "Sales CRM".'),
      icon: z.string().optional().describe('Optional emoji icon, e.g. "🎯".'),
      organization_id: organizationIdField,
    },
    handler: async ({ name, icon, organization_id }, ctx) => {
      const orgId = await ctx.resolveOrg(organization_id)
      return { base: await engineCreateBase(orgId, { name, icon: icon ?? null }, ctx.actor) }
    },
  }),

  // --- tables ---------------------------------------------------------------
  defineTool({
    name: 'list_tables',
    title: 'List tables',
    description:
      'List every table in the organization (id, name, slug, icon, description, base_id + ' +
      'base_name, position), optionally filtered to one base. Start here to see what ' +
      'exists; then call describe_table for field ids and types.',
    inputSchema: {
      base: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Only tables in this base — referenced by id (uuid), slug, or exact name ' +
            '(case-insensitive). Omit for all tables.',
        ),
      organization_id: organizationIdField,
    },
    handler: async ({ base, organization_id }, ctx) => {
      const orgId = await ctx.resolveOrg(organization_id)
      const baseId = base ? await resolveBaseId(orgId, base) : null
      const [tables, bases] = await Promise.all([
        engineListTables(orgId),
        engineListBases(orgId),
      ])
      const baseNames = new Map(bases.map((b) => [b.id, b.name]))
      const withBase = tables
        .filter((t) => (baseId ? t.base_id === baseId : true))
        .map((t) => ({
          ...t,
          base_name: t.base_id ? baseNames.get(t.base_id) ?? null : null,
        }))
      return { tables: withBase }
    },
  }),

  defineTool({
    name: 'describe_table',
    title: 'Describe table',
    description:
      'Full schema for one table: the table itself, every field (id, name, type, options, ' +
      'required, position), and every view. This is the map you need before reading or ' +
      'writing records — field ids key all record values, options.choices carries the valid ' +
      'select choice ids, options.linkedTableId shows where linked_record fields point, and ' +
      'formula fields carry their {fld:FIELD_ID} expression in options.expression. ' +
      'Computed field types (formula, lookup, rollup, autonumber, created_time, ' +
      'last_modified_time) are read-only.',
    inputSchema: { table: tableRef, organization_id: organizationIdField },
    handler: async ({ table, organization_id }, ctx) => {
      const orgId = await ctx.resolveOrg(organization_id)
      const tableId = await resolveTableId(orgId, table)
      return engineDescribeTable(orgId, tableId)
    },
  }),

  defineTool({
    name: 'create_table',
    title: 'Create table',
    description:
      'Create a new empty table. Only name is required; a url-safe slug is derived ' +
      '(uniqued with -2, -3… on collision). Pass `base` to create it inside a base ' +
      '(omit = ungrouped "Workspace"). Add fields with create_field next — a new ' +
      'table has none.',
    inputSchema: {
      name: z.string().min(1).describe('Human-readable table name, e.g. "Deals".'),
      icon: z.string().optional().describe('Optional emoji icon, e.g. "📈".'),
      description: z.string().optional().describe('Optional table description.'),
      base: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Base to create the table in — referenced by id (uuid), slug, or exact name ' +
            '(case-insensitive). Omit for no base.',
        ),
      organization_id: organizationIdField,
    },
    handler: async ({ name, icon, description, base, organization_id }, ctx) => {
      const orgId = await ctx.resolveOrg(organization_id)
      const baseId = base ? await resolveBaseId(orgId, base) : null
      return {
        table: await engineCreateTable(
          orgId,
          { name, icon: icon ?? null, description: description ?? null, baseId },
          ctx.actor,
        ),
      }
    },
  }),

  defineTool({
    name: 'update_table',
    title: 'Update table',
    description:
      'Rename a table or change its icon/description/position, or move it between bases ' +
      '(`base` to move, `clear_base` to ungroup). Only provided fields change. ' +
      'Renames are safe: records key values by field id and the slug is untouched.',
    inputSchema: {
      table: tableRef,
      name: z.string().min(1).optional().describe('New table name.'),
      icon: z.string().nullable().optional().describe('New emoji icon (null clears it).'),
      description: z.string().nullable().optional().describe('New description (null clears it).'),
      position: z.number().int().optional().describe('New sidebar position.'),
      base: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Move the table into this base — referenced by id (uuid), slug, or exact name ' +
            '(case-insensitive). Mutually exclusive with clear_base.',
        ),
      clear_base: z
        .boolean()
        .optional()
        .describe('true = remove the table from its base (back to the ungrouped "Workspace").'),
      organization_id: organizationIdField,
    },
    handler: async (
      { table, name, icon, description, position, base, clear_base, organization_id },
      ctx,
    ) => {
      if (base && clear_base) {
        throw new EngineError('Pass either `base` or `clear_base`, not both.', 'bad_input')
      }
      const orgId = await ctx.resolveOrg(organization_id)
      const tableId = await resolveTableId(orgId, table)
      const baseId = clear_base ? null : base ? await resolveBaseId(orgId, base) : undefined
      return {
        table: await engineUpdateTable(orgId, tableId, { name, icon, description, position, baseId }),
      }
    },
  }),

  defineTool({
    name: 'delete_table',
    title: 'Delete table',
    description:
      'Permanently delete a table with ALL of its fields, views, and records. Any ' +
      'linked_record fields on OTHER tables that pointed at it are deleted too. ' +
      'Irreversible — confirm before calling.',
    inputSchema: { table: tableRef, organization_id: organizationIdField },
    handler: async ({ table, organization_id }, ctx) => {
      const orgId = await ctx.resolveOrg(organization_id)
      const tableId = await resolveTableId(orgId, table)
      await engineDeleteTable(orgId, tableId)
      return { deleted: true, tableId }
    },
  }),

  // --- fields ---------------------------------------------------------------
  defineTool({
    name: 'create_field',
    title: 'Create field',
    description:
      'Add a field (column) to a table. Types: text, long_text, single_select, multi_select, ' +
      'number, currency, percent, checkbox, date, datetime, url, email, attachment, ' +
      'linked_record, lookup, rollup, formula, autonumber, created_time, last_modified_time. ' +
      'Type-specific options: single/multi_select need options.choices ' +
      '[{id, name, color?}] (values store the id); linked_record needs options.linkedTableId ' +
      '— the inverse field on the target table is created automatically as a pair; ' +
      'lookup needs options.recordLinkFieldId (a linked_record field on THIS table) plus ' +
      'options.targetFieldId (a concrete field on the linked table); rollup needs ' +
      'recordLinkFieldId + options.aggregate (count/sum/avg/min/max/concat) and, except for ' +
      'count, targetFieldId; formula needs options.expression — arithmetic over same-table ' +
      'number/currency/percent fields via {fld:FIELD_ID} tokens (get ids from ' +
      'describe_table), e.g. "{fld:AMOUNT_ID} * {fld:PROBABILITY_ID}". percent values are ' +
      'stored as 0-1 fractions. Field type is immutable after creation.',
    inputSchema: {
      table: tableRef,
      name: z.string().min(1).describe('Field name, e.g. "Stage".'),
      type: FIELD_TYPE_ENUM.describe('The field type (immutable once created).'),
      options: fieldOptionsSchema.optional(),
      required: z.boolean().optional().describe('Reject empty values on write (default false).'),
      position: z.number().int().optional().describe('Column position (default: append).'),
      organization_id: organizationIdField,
    },
    handler: async ({ table, name, type, options, required, position, organization_id }, ctx) => {
      const orgId = await ctx.resolveOrg(organization_id)
      const tableId = await resolveTableId(orgId, table)
      return {
        field: await engineCreateField(
          orgId,
          tableId,
          { name, type, options: options as FieldOptions | undefined, required, position },
          ctx.actor,
        ),
      }
    },
  }),

  defineTool({
    name: 'update_field',
    title: 'Update field',
    description:
      'Rename a field or change its options/required/position. Only provided fields change. ' +
      'The TYPE is immutable (delete and recreate to change it), and a linked_record field ' +
      'cannot be repointed at a different table. When updating options, send the complete ' +
      'options object (e.g. the full choices list — it replaces, not merges). Keep existing ' +
      'choice ids stable or records referencing them become invalid.',
    inputSchema: {
      table: tableRef,
      field_id: z.string().uuid().describe('The field id (from describe_table).'),
      name: z.string().min(1).optional().describe('New field name (renames are free).'),
      options: fieldOptionsSchema.optional().describe('Replacement options object.'),
      required: z.boolean().optional(),
      position: z.number().int().optional(),
      organization_id: organizationIdField,
    },
    handler: async ({ table, field_id, name, options, required, position, organization_id }, ctx) => {
      const orgId = await ctx.resolveOrg(organization_id)
      const tableId = await resolveTableId(orgId, table)
      return {
        field: await engineUpdateField(orgId, tableId, field_id, {
          name,
          options: options as FieldOptions | undefined,
          required,
          position,
        }),
      }
    },
  }),

  defineTool({
    name: 'delete_field',
    title: 'Delete field',
    description:
      'Permanently delete a field. Deleting a linked_record field also deletes its paired ' +
      'inverse field on the target table and every link edge between them. Irreversible.',
    inputSchema: {
      table: tableRef,
      field_id: z.string().uuid().describe('The field id (from describe_table).'),
      organization_id: organizationIdField,
    },
    handler: async ({ table, field_id, organization_id }, ctx) => {
      const orgId = await ctx.resolveOrg(organization_id)
      const tableId = await resolveTableId(orgId, table)
      await engineDeleteField(orgId, tableId, field_id)
      return { deleted: true, fieldId: field_id }
    },
  }),

  // --- records ----------------------------------------------------------------
  defineTool({
    name: 'query_records',
    title: 'Query records',
    description:
      'List/filter/sort records in a table with pagination. Each record returns raw `values` ' +
      '(keyed by field id: stored scalars, choice ids, linked-record id arrays) plus a ' +
      'computed `display` map (linked_record → [{id, label}], lookup → pulled values, ' +
      'rollup/formula → the computed result). Filters and sorts work on concrete fields only ' +
      '(not computed or linked_record fields). Response includes `total` for pagination. ' +
      'Select filters compare choice IDS, not display names; percent compares 0-1 fractions.',
    inputSchema: {
      table: tableRef,
      filters: filterSchema.array().optional().describe('All conditions must match (AND).'),
      sorts: sortSchema.array().optional(),
      limit: z.number().int().min(1).max(500).optional().describe('Page size (default 100, max 500).'),
      offset: z.number().int().min(0).optional().describe('Rows to skip (default 0).'),
      organization_id: organizationIdField,
    },
    handler: async ({ table, filters, sorts, limit, offset, organization_id }, ctx) => {
      const orgId = await ctx.resolveOrg(organization_id)
      const tableId = await resolveTableId(orgId, table)
      return engineQueryRecords(orgId, tableId, {
        filters: filters as FilterCondition[] | undefined,
        sorts: sorts as SortSpec[] | undefined,
        limit,
        offset,
      })
    },
  }),

  defineTool({
    name: 'get_record',
    title: 'Get record',
    description:
      'Fetch one record by id: raw `values` (keyed by field id) plus the computed `display` ' +
      'map (linked-record labels, lookups, rollups, formulas). Set include_revisions to also ' +
      'get its full audit trail — every create/update with actor attribution and per-field ' +
      'diffs, newest first.',
    inputSchema: {
      table: tableRef,
      record_id: z.string().uuid().describe('The record id.'),
      include_revisions: z
        .boolean()
        .optional()
        .describe('Also return the record\'s revision history (default false).'),
      organization_id: organizationIdField,
    },
    handler: async ({ table, record_id, include_revisions, organization_id }, ctx) => {
      const orgId = await ctx.resolveOrg(organization_id)
      const tableId = await resolveTableId(orgId, table)
      const record = await getRecordEnriched(orgId, tableId, record_id)
      if (!record) throw new EngineError(`No record ${record_id} in this table.`, 'not_found')
      if (!include_revisions) return { record }
      const revisions = await listRecordRevisions(orgId, record_id)
      return { record, revisions }
    },
  }),

  defineTool({
    name: 'create_record',
    title: 'Create record',
    description:
      'Create a record. `values` maps field id → value; omitted non-required fields stay ' +
      'empty. ' +
      VALUE_FORMATS +
      ' Call describe_table first for field ids, choice ids, and linked table ids. The write ' +
      'is validated per field type and logged in the audit trail with agent attribution.',
    inputSchema: {
      table: tableRef,
      values: z
        .record(z.unknown())
        .describe('Map of field id (uuid from describe_table) → value.'),
      organization_id: organizationIdField,
    },
    handler: async ({ table, values, organization_id }, ctx) => {
      const orgId = await ctx.resolveOrg(organization_id)
      const tableId = await resolveTableId(orgId, table)
      return { record: await engineCreateRecord(orgId, tableId, values, ctx.actor) }
    },
  }),

  defineTool({
    name: 'update_record',
    title: 'Update record',
    description:
      'Update fields on a record. `values` is a PARTIAL patch keyed by field id — only the ' +
      'field ids you include change; a linked_record entry REPLACES that field\'s full link ' +
      'set (send the complete desired id array); null clears a field. ' +
      VALUE_FORMATS +
      ' Every change lands in the revision log with a per-field {from, to} diff, so e.g. ' +
      'stage history on a single_select needs no extra bookkeeping — just update the field.',
    inputSchema: {
      table: tableRef,
      record_id: z.string().uuid().describe('The record id.'),
      values: z
        .record(z.unknown())
        .describe('Partial map of field id → new value (null to clear).'),
      organization_id: organizationIdField,
    },
    handler: async ({ table, record_id, values, organization_id }, ctx) => {
      const orgId = await ctx.resolveOrg(organization_id)
      const tableId = await resolveTableId(orgId, table)
      return { record: await engineUpdateRecord(orgId, tableId, record_id, values, ctx.actor) }
    },
  }),

  defineTool({
    name: 'delete_records',
    title: 'Delete records',
    description:
      'Delete one or more records by id (link edges cascade). Each deletion is logged in the ' +
      'audit trail with the record\'s final values, so it stays inspectable via ' +
      'list_revisions. Returns how many were actually deleted.',
    inputSchema: {
      table: tableRef,
      record_ids: z.array(z.string().uuid()).min(1).describe('Record ids to delete.'),
      organization_id: organizationIdField,
    },
    handler: async ({ table, record_ids, organization_id }, ctx) => {
      const orgId = await ctx.resolveOrg(organization_id)
      const tableId = await resolveTableId(orgId, table)
      return engineDeleteRecords(orgId, tableId, record_ids, ctx.actor)
    },
  }),

  // --- views ------------------------------------------------------------------
  defineTool({
    name: 'list_views',
    title: 'List views',
    description:
      'List a table\'s saved views (grid, kanban, or form) with their config: filters, sorts, ' +
      'visible fields, kanban grouping, and form settings (fields, publicSlug).',
    inputSchema: { table: tableRef, organization_id: organizationIdField },
    handler: async ({ table, organization_id }, ctx) => {
      const orgId = await ctx.resolveOrg(organization_id)
      const tableId = await resolveTableId(orgId, table)
      return { views: await engineListViews(orgId, tableId) }
    },
  }),

  defineTool({
    name: 'create_view',
    title: 'Create view',
    description:
      'Create a saved view on a table. type "grid" (default), "kanban", or "form". For kanban, set ' +
      'config.groupByFieldId to a single_select field id — its choices become the columns. ' +
      'config filters/sorts use the same shapes as query_records. For a form, set config.fields ' +
      'to the form-writable fields (no computed, no linked_record) in order; the engine mints a ' +
      'unique config.publicSlug and serves the form publicly (no auth) at /f/<publicSlug>.',
    inputSchema: {
      table: tableRef,
      name: z.string().min(1).describe('View name, e.g. "Pipeline".'),
      type: z.enum(['grid', 'kanban', 'form']).optional().describe('View type (default "grid").'),
      config: viewConfigSchema.optional(),
      organization_id: organizationIdField,
    },
    handler: async ({ table, name, type, config, organization_id }, ctx) => {
      const orgId = await ctx.resolveOrg(organization_id)
      const tableId = await resolveTableId(orgId, table)
      return {
        view: await engineCreateView(orgId, tableId, {
          name,
          type: type as ViewType | undefined,
          config: config as ViewConfig | undefined,
        }),
      }
    },
  }),

  defineTool({
    name: 'update_view',
    title: 'Update view',
    description:
      'Rename a view or change its type/config/position. `config` REPLACES the whole config ' +
      'object — read the current one via list_views first if you only want to tweak part.',
    inputSchema: {
      table: tableRef,
      view_id: z.string().uuid().describe('The view id (from list_views).'),
      name: z.string().min(1).optional(),
      type: z.enum(['grid', 'kanban', 'form']).optional(),
      config: viewConfigSchema.optional().describe('Replacement config object.'),
      position: z.number().int().optional(),
      organization_id: organizationIdField,
    },
    handler: async ({ table, view_id, name, type, config, position, organization_id }, ctx) => {
      const orgId = await ctx.resolveOrg(organization_id)
      const tableId = await resolveTableId(orgId, table)
      return {
        view: await engineUpdateView(orgId, tableId, view_id, {
          name,
          type: type as ViewType | undefined,
          config: config as ViewConfig | undefined,
          position,
        }),
      }
    },
  }),

  defineTool({
    name: 'delete_view',
    title: 'Delete view',
    description: 'Delete a saved view. Records and fields are untouched.',
    inputSchema: {
      table: tableRef,
      view_id: z.string().uuid().describe('The view id (from list_views).'),
      organization_id: organizationIdField,
    },
    handler: async ({ table, view_id, organization_id }, ctx) => {
      const orgId = await ctx.resolveOrg(organization_id)
      const tableId = await resolveTableId(orgId, table)
      await engineDeleteView(orgId, tableId, view_id)
      return { deleted: true, viewId: view_id }
    },
  }),

  // --- revisions ----------------------------------------------------------------
  defineTool({
    name: 'list_revisions',
    title: 'List record revisions',
    description:
      'The full audit trail for one record, newest first. Each revision carries actor_type ' +
      '(user/agent/api) + actor_id, the operation (create/update/delete), a timestamp, and a ' +
      'diff of {fieldId: {from, to}} for every changed field. This is also the stage-change ' +
      'history: transitions of a single_select field (e.g. a pipeline Stage) appear here ' +
      'automatically with exact timestamps — no hand-maintained stage-timestamp columns.',
    inputSchema: {
      record_id: z.string().uuid().describe('The record id.'),
      limit: z.number().int().min(1).max(500).optional().describe('Max revisions (default 100).'),
      organization_id: organizationIdField,
    },
    handler: async ({ record_id, limit, organization_id }, ctx) => {
      const orgId = await ctx.resolveOrg(organization_id)
      return { revisions: await listRecordRevisions(orgId, record_id, limit) }
    },
  }),
]

/** Lookup helper for tests and the server registrar. */
export function getTool(name: string): EngineToolDef {
  const t = tools.find((t) => t.name === name)
  if (!t) throw new Error(`No such engine tool: ${name}`)
  return t
}
