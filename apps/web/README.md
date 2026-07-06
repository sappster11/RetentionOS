# @retentionos/web

RetentionOS web app — UI + API routes + in-app agent runtime.

## In-app agent environment variables

The chat agent (`/api/agent/chat`) picks its model provider from the environment,
in this order:

| Variable | Effect |
| --- | --- |
| `ANTHROPIC_API_KEY` | Use the Anthropic API directly (first-class provider). Wins when both keys are set. Default model: `claude-sonnet-5`. |
| `OPENROUTER_API_KEY` | Used only when `ANTHROPIC_API_KEY` is absent. Calls OpenRouter's OpenAI-compatible endpoint. Default model: `anthropic/claude-sonnet-5`. |
| `ROS_AGENT_MODEL` | Optional model override for whichever provider is active. Use the provider's own id format — e.g. `claude-sonnet-5` for Anthropic, `anthropic/claude-sonnet-5` for OpenRouter. |

With neither key set, the API answers `{disabled: true}` and the chat panel shows
setup guidance instead of erroring. External agents keep full access via MCP
regardless.

Set these in Vercel → Settings → Environment Variables, or in your local `.env`.
