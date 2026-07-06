// The zod -> Anthropic input_schema converter, run against the REAL shared tool defs
// (single source of truth: @retentionos/mcp-engine/tools).
import { describe, expect, it } from 'vitest'
import { getTool, tools } from '@retentionos/mcp-engine/tools'
import { toAnthropicTool, toolInputJsonSchema } from '../lib/agent/toolSchema'

type Schema = Record<string, any>

describe('toolInputJsonSchema', () => {
  it('converts every engine tool to a top-level object schema', () => {
    expect(tools.length).toBeGreaterThanOrEqual(18)
    for (const tool of tools) {
      const schema = toolInputJsonSchema(tool.inputSchema) as Schema
      expect(schema.type, tool.name).toBe('object')
      expect(schema.properties, tool.name).toBeTypeOf('object')
      expect(schema.$schema, tool.name).toBeUndefined()
    }
  })

  it('marks only non-optional fields as required', () => {
    const schema = toolInputJsonSchema(getTool('query_records').inputSchema) as Schema
    expect(schema.required).toEqual(['table'])
  })

  it('preserves descriptions, enums, and numeric bounds', () => {
    const schema = toolInputJsonSchema(getTool('query_records').inputSchema) as Schema
    // description from .describe()
    expect(schema.properties.table.description).toMatch(/id \(uuid\), slug/)
    // z.enum -> JSON Schema enum (filter op, nested in the filters array items)
    const filterItem = schema.properties.filters.items
    expect(filterItem.properties.op.enum).toContain('contains')
    // z.number().int().min(1).max(500) -> integer with bounds
    const limit = schema.properties.limit
    expect(limit.type).toBe('integer')
    expect(limit.minimum).toBe(1)
    expect(limit.maximum).toBe(500)
  })

  it('converts string formats (uuid) and arrays', () => {
    const schema = toolInputJsonSchema(getTool('delete_records').inputSchema) as Schema
    const ids = schema.properties.record_ids
    expect(ids.type).toBe('array')
    expect(ids.minItems).toBe(1)
    expect(ids.items.type).toBe('string')
    expect(ids.items.format).toBe('uuid')
  })

  it('converts z.record values maps to open objects', () => {
    const schema = toolInputJsonSchema(getTool('create_record').inputSchema) as Schema
    const values = schema.properties.values
    expect(values.type).toBe('object')
    // record of unknown -> arbitrary properties allowed
    expect(values.additionalProperties).not.toBe(false)
  })

  it('keeps passthrough option objects open (unknown option keys survive)', () => {
    const schema = toolInputJsonSchema(getTool('create_field').inputSchema) as Schema
    expect(schema.properties.options.additionalProperties).toBe(true)
  })
})

describe('toAnthropicTool', () => {
  it('produces the Anthropic tools[] entry shape', () => {
    const tool = toAnthropicTool(getTool('describe_table'))
    expect(tool).toMatchObject({ name: 'describe_table' })
    expect(tool.description).toMatch(/field/)
    expect((tool.input_schema as Schema).type).toBe('object')
  })
})
