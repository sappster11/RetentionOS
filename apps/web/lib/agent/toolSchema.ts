// Maps the shared engine tool definitions (zod shapes, from
// @retentionos/mcp-engine/tools) to the Anthropic Messages API tool format.
// zod-to-json-schema is already in the dependency tree (the MCP SDK uses it for the
// exact same job on the stdio side), so both transports derive their wire schemas from
// the SAME zod source of truth.
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { EngineToolDef } from '@retentionos/mcp-engine/tools'

/** The subset of the Anthropic `tools` array entry we produce. */
export interface AnthropicToolParam {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

/** Convert one tool's ZodRawShape input to a JSON Schema object suitable for
 * `input_schema`. `$refStrategy: 'none'` inlines everything (Anthropic tool schemas
 * don't resolve external/internal $refs), and the top-level `$schema` marker is
 * dropped because it isn't part of the tool schema contract. */
export function toolInputJsonSchema(shape: z.ZodRawShape): Record<string, unknown> {
  const schema = zodToJsonSchema(z.object(shape), { $refStrategy: 'none' }) as Record<
    string,
    unknown
  >
  delete schema.$schema
  return schema
}

export function toAnthropicTool(
  def: Pick<EngineToolDef, 'name' | 'description' | 'inputSchema'>,
): AnthropicToolParam {
  return {
    name: def.name,
    description: def.description,
    input_schema: toolInputJsonSchema(def.inputSchema),
  }
}
