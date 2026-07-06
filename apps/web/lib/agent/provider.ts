// Env-based provider selection for the in-app agent. Precedence:
//   1. ANTHROPIC_API_KEY  → Anthropic (first-class provider)
//   2. OPENROUTER_API_KEY → OpenRouter (OpenAI-compatible adapter, ./openrouter.ts)
//   3. neither            → null (the route answers {disabled: true} and the panel
//                            shows setup guidance)
// ROS_AGENT_MODEL overrides the model for whichever provider is active.
import { OPENROUTER_DEFAULT_MODEL } from './openrouter'

export const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-5'

export interface AgentProviderConfig {
  provider: 'anthropic' | 'openrouter'
  apiKey: string
  model: string
}

export function chooseAgentProvider(
  env: Record<string, string | undefined> = process.env,
): AgentProviderConfig | null {
  if (env.ANTHROPIC_API_KEY) {
    return {
      provider: 'anthropic',
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.ROS_AGENT_MODEL || ANTHROPIC_DEFAULT_MODEL,
    }
  }
  if (env.OPENROUTER_API_KEY) {
    return {
      provider: 'openrouter',
      apiKey: env.OPENROUTER_API_KEY,
      model: env.ROS_AGENT_MODEL || OPENROUTER_DEFAULT_MODEL,
    }
  }
  return null
}
