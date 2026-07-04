#!/usr/bin/env tsx
// Content MCP server — the "works with any model" layer for the content engine
// (docs/04-ai-and-agent-layer.md), mirroring packages/mcp-crm's shape.
//
// Exposes draft → review → approve → queue as tools over stdio, backed by
// @retentionos/content (drafting/preview logic) and @retentionos/db (persistence) — the
// SAME data-access layer the web app uses. So the same tools work from Claude Desktop/Code
// and from an OpenAI Agents-SDK caller, against the same owned Postgres.
//
// Tenant-safety: this server talks to Postgres directly (no RLS), so it MUST scope every
// query by organization_id itself. Every tool resolves its org via resolveOrg() first.
//
// IMPORTANT: `queue_send` does NOT call Resend/Twilio/any ESP. It only creates `messages`
// rows with status 'queued' — actual delivery needs provider credentials, which this
// environment does not have. See the tool description and its returned summary.

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  createMessage,
  getAudience,
  getCampaign,
  getDefaultOrganization,
  listCampaigns,
  listTemplates,
  listVariants,
  logActivity,
  resolveAudience,
  updateCampaignStatus,
} from '@retentionos/db'
import type { AudienceDefinition, CampaignChannel, MessageProvider } from '@retentionos/db'
import { audienceDefinitionSchema, draftCampaign, personalize, previewPersonalized } from '@retentionos/content'
import { z } from 'zod'

// The org this server operates within. In-app runtime derives this from the authed
// session; for the stdio server it's provided by env (or per-tool override).
const DEFAULT_ORG_ID = process.env.RETENTIONOS_ORG_ID

if (!process.env.DATABASE_URL) {
  // @retentionos/db's connection pool throws lazily on first query if this is unset —
  // fail fast here instead, with a message that points at the fix.
  console.error('Missing DATABASE_URL. See .env.example / docs/LOCAL_DEV.md.')
  process.exit(1)
}

/**
 * Resolve the organization to scope a tool call to: an explicit per-call override, else
 * the server-wide RETENTIONOS_ORG_ID, else the first (only, in dev) organization in the
 * database. Throws if none of those resolve — every tool must call this before touching
 * the database, so tenant scoping is never accidentally skipped.
 */
async function resolveOrg(inputOrgId?: string): Promise<string> {
  if (inputOrgId) return inputOrgId
  if (DEFAULT_ORG_ID) return DEFAULT_ORG_ID
  const org = await getDefaultOrganization()
  if (org?.id) return org.id
  throw new Error(
    'No organization_id provided, RETENTIONOS_ORG_ID is not set, and no organization exists.',
  )
}

function ok(result: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return { isError: true, content: [{ type: 'text' as const, text: message }] }
}

const organizationIdField = z
  .string()
  .uuid()
  .optional()
  .describe(
    'Organization to scope to. Defaults to the server RETENTIONOS_ORG_ID, then the ' +
      'first organization in the database. Only pass this if you need to target a ' +
      'specific tenant explicitly.',
  )

const clientIdField = z.string().uuid().describe('The client account id (UUID).')
const campaignIdField = z.string().uuid().describe('The campaign id (UUID).')
const channelField = z.enum(['email', 'sms']).describe('Delivery channel.')

const server = new McpServer({
  name: 'retentionos-content',
  version: '0.1.0',
})

server.registerTool(
  'list_templates',
  {
    title: 'List templates',
    description:
      'List content templates, optionally filtered by client and/or channel. Agency-wide ' +
      'templates (client_id null) are included alongside client-specific ones when a ' +
      'client_id is given.',
    inputSchema: {
      client_id: z.string().uuid().optional().describe('Filter to templates usable by this client.'),
      channel: channelField.optional(),
      organization_id: organizationIdField,
    },
  },
  async ({ client_id, channel, organization_id }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const templates = await listTemplates(orgId, { clientId: client_id, channel })
      return ok({ templates })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'list_campaigns',
  {
    title: 'List campaigns',
    description: 'List campaigns for an organization, optionally filtered by client and/or status.',
    inputSchema: {
      client_id: z.string().uuid().optional().describe('Filter to this client.'),
      status: z
        .enum(['draft', 'in_review', 'approved', 'scheduled', 'sent', 'archived'])
        .optional()
        .describe('Filter to this status.'),
      organization_id: organizationIdField,
    },
  },
  async ({ client_id, status, organization_id }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const campaigns = await listCampaigns(orgId, { clientId: client_id, status })
      return ok({ campaigns })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'get_campaign',
  {
    title: 'Get campaign',
    description: 'Fetch a single campaign by id, including all of its variants.',
    inputSchema: {
      campaign_id: campaignIdField,
      organization_id: organizationIdField,
    },
  },
  async ({ campaign_id, organization_id }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const campaign = await getCampaign(orgId, campaign_id)
      if (!campaign) {
        return ok({ found: false, message: `No campaign found with id ${campaign_id}.` })
      }
      const variants = await listVariants(orgId, campaign_id)
      return ok({ found: true, campaign, variants })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'draft_campaign',
  {
    title: 'Draft campaign',
    description:
      'Draft a new retention campaign: resolves the given audience against live retention ' +
      'analytics, generates grounded subject+body copy (falling back to a deterministic ' +
      'template if no model is configured), and persists the audience/campaign/variant(s) ' +
      'as status "draft". Logs a campaign.drafted activity. If drafting fell back to the ' +
      'template (no API key available), the result notes used_fallback: true — the copy is ' +
      'still a real, sensible draft, just not model-generated.',
    inputSchema: {
      client_id: clientIdField,
      name: z.string().min(1).describe('Campaign name.'),
      channel: channelField,
      goal: z
        .enum(['winback', 'onboarding', 'retention', 'reengagement', 'announcement'])
        .describe('Campaign goal/type.'),
      audience: audienceDefinitionSchema.describe(
        'Audience definition to resolve against client_customer_metrics: segment ' +
          '(lifecycle stage, e.g. "at_risk"), max_recency_days, min_monetary, min_rfm_monetary.',
      ),
      variant_count: z
        .number()
        .int()
        .min(1)
        .max(6)
        .optional()
        .describe('How many copy variants to draft (labeled A, B, C, ...). Defaults to 1.'),
      brand_voice: z.string().optional().describe('Optional brand-voice guidance for the copy.'),
      organization_id: organizationIdField,
    },
  },
  async ({ client_id, name, channel, goal, audience, variant_count, brand_voice, organization_id }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const result = await draftCampaign({
        orgId,
        clientId: client_id,
        name,
        channel,
        goal,
        audienceDefinition: audience as AudienceDefinition,
        brandVoice: brand_voice,
        variantCount: variant_count,
      })
      return ok({
        campaign: result.campaign,
        variants: result.variants,
        grounded_on: result.grounded_on,
        used_fallback: result.used_fallback,
        note: result.used_fallback
          ? 'No model API key was available in this environment — copy was produced by the ' +
            'deterministic template fallback, not an LLM.'
          : undefined,
      })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'preview_personalized',
  {
    title: 'Preview personalized copy',
    description:
      'Read-only preview for human review: re-resolves the campaign\'s audience and returns ' +
      'the first N members with each variant\'s copy personalized ({{first_name}}, ' +
      '{{discount_code}}) for them.',
    inputSchema: {
      campaign_id: campaignIdField,
      limit: z.number().int().min(1).max(50).optional().describe('Max members to preview (default 3).'),
      organization_id: organizationIdField,
    },
  },
  async ({ campaign_id, limit, organization_id }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const preview = await previewPersonalized({ orgId, campaignId: campaign_id, limit })
      return ok(preview)
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'approve_campaign',
  {
    title: 'Approve campaign',
    description:
      'Mark a campaign as approved, the gate that queue_send requires before it will queue ' +
      'any messages. Logs a campaign.approved activity.',
    inputSchema: {
      campaign_id: campaignIdField,
      organization_id: organizationIdField,
    },
  },
  async ({ campaign_id, organization_id }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const campaign = await updateCampaignStatus(orgId, campaign_id, 'approved')
      if (!campaign) {
        return ok({ found: false, message: `No campaign found with id ${campaign_id}.` })
      }
      await logActivity(orgId, {
        client_id: campaign.client_id,
        actor_type: 'agent',
        verb: 'campaign.approved',
        summary: `Approved campaign "${campaign.name}"`,
        data: { campaign_id: campaign.id },
      })
      return ok({ campaign })
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'queue_send',
  {
    title: 'Queue send',
    description:
      'Queue a campaign for delivery: requires the campaign to already be "approved" ' +
      '(use approve_campaign first), then re-resolves its audience and creates one ' +
      '"messages" row per member (subject/body personalized from variant A), marks the ' +
      'campaign "sent", and logs a campaign.queued activity. ' +
      'IMPORTANT: this does NOT call Resend/Twilio or any other provider — it only queues ' +
      '"messages" rows. Actual delivery requires provider credentials this environment does ' +
      'not have; the returned summary notes this explicitly.',
    inputSchema: {
      campaign_id: campaignIdField,
      provider: z
        .enum(['resend', 'twilio', 'client_esp'])
        .optional()
        .describe('Delivery provider to record on each message. Defaults to resend for email, twilio for sms.'),
      organization_id: organizationIdField,
    },
  },
  async ({ campaign_id, provider, organization_id }) => {
    try {
      const orgId = await resolveOrg(organization_id)
      const campaign = await getCampaign(orgId, campaign_id)
      if (!campaign) {
        return ok({ found: false, message: `No campaign found with id ${campaign_id}.` })
      }
      if (campaign.status !== 'approved') {
        return fail('Campaign must be approved before sending.')
      }
      if (!campaign.audience_id) {
        return fail(`Campaign ${campaign_id} has no associated audience to send to.`)
      }

      const audience = await getAudience(orgId, campaign.audience_id)
      if (!audience) {
        return fail(`No audience found with id ${campaign.audience_id}.`)
      }

      const variants = await listVariants(orgId, campaign_id)
      const variantA = variants.find((v) => v.label === 'A') ?? variants[0]
      if (!variantA) {
        return fail(`Campaign ${campaign_id} has no variants to send.`)
      }

      const members = await resolveAudience(
        orgId,
        campaign.client_id,
        audience.definition as unknown as AudienceDefinition,
      )

      const resolvedProvider: MessageProvider = provider ?? defaultProviderFor(campaign.channel)

      const messages = []
      for (const member of members) {
        const message = await createMessage(orgId, {
          client_id: campaign.client_id,
          campaign_id: campaign.id,
          customer_id: member.customer_id,
          channel: campaign.channel,
          to_address: campaign.channel === 'email' ? member.email ?? undefined : undefined,
          rendered_subject: variantA.subject ? personalize(variantA.subject, member) : undefined,
          rendered_body: variantA.body ? personalize(variantA.body, member) : undefined,
          provider: resolvedProvider,
          status: 'queued',
        })
        messages.push(message)
      }

      await updateCampaignStatus(orgId, campaign_id, 'sent')

      const summary =
        `Queued ${messages.length} message(s) for campaign "${campaign.name}"; delivery ` +
        'integration pending provider credentials.'

      await logActivity(orgId, {
        client_id: campaign.client_id,
        actor_type: 'agent',
        verb: 'campaign.queued',
        summary,
        data: { campaign_id: campaign.id, message_count: messages.length, provider: resolvedProvider },
      })

      return ok({ queued: messages.length, provider: resolvedProvider, messages, summary })
    } catch (error) {
      return fail(error)
    }
  },
)

function defaultProviderFor(channel: CampaignChannel): MessageProvider {
  return channel === 'email' ? 'resend' : 'twilio'
}

server.registerResource(
  'campaign',
  new ResourceTemplate('campaign://{id}', { list: undefined }),
  {
    title: 'Campaign',
    description:
      'A single campaign, as JSON. Resolve the org via the server default ' +
      '(RETENTIONOS_ORG_ID) — this resource does not take an organization override.',
    mimeType: 'application/json',
  },
  async (uri, { id }) => {
    const campaignId = Array.isArray(id) ? id[0] : id
    if (!campaignId) throw new Error('campaign:// resource requires a non-empty id.')
    const orgId = await resolveOrg()
    const campaign = await getCampaign(orgId, campaignId)
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(
            campaign ?? { found: false, message: `No campaign found with id ${campaignId}.` },
            null,
            2,
          ),
        },
      ],
    }
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
console.error('retentionos-content MCP server running on stdio')
