// @retentionos/content — the content-generation library.
//
// Turns a resolved audience + a goal into campaign copy, grounded in the same retention
// analytics the rest of the app reads (client_customer_metrics via resolveAudience). Calls
// through @retentionos/ai's provider-agnostic generate(); when no API key is configured (or
// RETENTIONOS_CONTENT_FALLBACK=1 forces it), falls back to a deterministic template draft so
// the rest of the pipeline (persistence, review, send-queueing) still works without a key.
//
// Persistence goes through @retentionos/db — the same data-access layer the web app and the
// MCP servers use, so a campaign drafted here shows up identically everywhere.

import {
  createAudience,
  createCampaign,
  createVariant,
  getAudience,
  getCampaign,
  listVariants,
  logActivity,
  resolveAudience,
} from '@retentionos/db'
import type {
  AudienceDefinition,
  Campaign,
  CampaignChannel,
  CampaignGoal,
  CampaignVariant,
  ResolvedAudienceMember,
} from '@retentionos/db'
import { generate, modelRouting } from '@retentionos/ai'
import type { Task } from '@retentionos/ai'
import { z } from 'zod'

/** Zod schema mirroring db's AudienceDefinition — reused by mcp-content's tool inputSchema
 *  so untrusted MCP input is validated with the exact same shape resolveAudience expects. */
export const audienceDefinitionSchema = z.object({
  segment: z.string().optional(),
  max_recency_days: z.number().optional(),
  min_monetary: z.number().optional(),
  min_rfm_monetary: z.number().optional(),
  limit: z.number().int().positive().optional(),
})

// ---------------------------------------------------------------------------
// Audience summarization — the "grounding" data the prompt (and the fallback) are built from.
// ---------------------------------------------------------------------------

export interface AudienceSummary {
  audience_size: number
  avg_monetary: number
  avg_recency_days: number
  top_first_names: string[]
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function summarizeAudience(members: ResolvedAudienceMember[]): AudienceSummary {
  const size = members.length
  const monetaryTotal = members.reduce((sum, m) => sum + (Number(m.monetary) || 0), 0)
  const recencyMembers = members.filter((m) => m.recency_days !== null)
  const recencyTotal = recencyMembers.reduce((sum, m) => sum + (m.recency_days ?? 0), 0)
  const topFirstNames = members
    .slice(0, 5)
    .map((m) => m.first_name)
    .filter((name): name is string => !!name)

  return {
    audience_size: size,
    avg_monetary: size > 0 ? round2(monetaryTotal / size) : 0,
    avg_recency_days: recencyMembers.length > 0 ? Math.round(recencyTotal / recencyMembers.length) : 0,
    top_first_names: topFirstNames,
  }
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function buildSystemPrompt(channel: CampaignChannel, brandVoice?: string): string {
  const voice = brandVoice
    ? `Brand voice: ${brandVoice}.`
    : 'Brand voice: warm, direct, no corporate jargon.'
  return (
    `You write retention ${channel} copy for an e-commerce brand. ${voice} ` +
    'Keep copy concise, concrete, and grounded in the audience data you are given — do not ' +
    'invent facts about the brand or the customers. Always use the literal placeholder tokens ' +
    '{{first_name}}' +
    (channel === 'email' ? ' and {{discount_code}}' : ' and {{discount_code}}') +
    ' wherever those values belong; do not fill them in yourself.'
  )
}

function buildUserPrompt(
  goal: CampaignGoal,
  summary: AudienceSummary,
  channel: CampaignChannel,
  segment?: string,
): string {
  const segmentLabel = segment ? segment.replace(/_/g, ' ') : 'targeted'
  const lines = [
    `Goal: ${goal} campaign for a ${segmentLabel} segment.`,
    `Audience: ${summary.audience_size} customers, average lifetime spend $${summary.avg_monetary.toFixed(2)}, ` +
      `average recency ${summary.avg_recency_days} days since last order.`,
    summary.top_first_names.length > 0
      ? `A few customers in this audience: ${summary.top_first_names.join(', ')}.`
      : undefined,
    'Use {{first_name}} for the customer name.',
    channel === 'email'
      ? 'Use {{discount_code}} for the discount code. Return the subject line first as ' +
        '"Subject: ..." on its own line, then a blank line, then the email body.'
      : 'Use {{discount_code}} for the discount code. Return only the SMS body text (keep it short).',
  ].filter((line): line is string => !!line)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Draft parsing
// ---------------------------------------------------------------------------

interface Draft {
  subject?: string
  body: string
}

function parseEmailDraft(raw: string): Draft {
  const lines = raw.split(/\r?\n/)
  const firstLine = lines[0] ?? ''
  const match = firstLine.match(/^\s*subject:\s*(.+)$/i)
  if (match) {
    const subject = match[1]?.trim() ?? ''
    const body = lines.slice(1).join('\n').trim()
    return { subject, body: body || raw.trim() }
  }
  return { subject: 'A note from us', body: raw.trim() }
}

function parseSmsDraft(raw: string): Draft {
  return { body: raw.trim() }
}

// ---------------------------------------------------------------------------
// Keyless fallback — deterministic, template-based, no LLM call.
// ---------------------------------------------------------------------------

function fallbackDraft(
  channel: CampaignChannel,
  summary: AudienceSummary,
  segment?: string,
): Draft {
  const segmentLabel = segment ? segment.replace(/_/g, ' ') : 'valued'
  const sizeClause =
    summary.audience_size > 0
      ? `You're one of ${summary.audience_size} ${segmentLabel} customers we've missed — ` +
        `averaging $${summary.avg_monetary.toFixed(2)} with us.`
      : `You're one of our ${segmentLabel} customers.`

  if (channel === 'email') {
    return {
      subject: "We miss you — here's 15% back",
      body:
        `Hi {{first_name}},\n\n` +
        `It's been about ${summary.avg_recency_days || 'a few'} days since your last order. ` +
        `${sizeClause}\n\n` +
        `Come back and take 15% off your next order with code {{discount_code}}.\n\n` +
        `See you soon,\nThe team`,
    }
  }

  return {
    body: `Hi {{first_name}}, it's been a bit! Here's 15% off to come back: {{discount_code}}`,
  }
}

// ---------------------------------------------------------------------------
// draftCampaign
// ---------------------------------------------------------------------------

export interface DraftCampaignArgs {
  orgId: string
  clientId: string
  name: string
  channel: CampaignChannel
  goal: CampaignGoal
  audienceDefinition: AudienceDefinition
  brandVoice?: string
  variantCount?: number
}

export interface DraftCampaignResult {
  campaign: Campaign
  variants: CampaignVariant[]
  grounded_on: AudienceSummary
  used_fallback: boolean
}

const VARIANT_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'] as const

/**
 * Draft a campaign: resolve the audience, build a grounded prompt, call the provider-agnostic
 * generate() (falling back to a deterministic template on any error, e.g. no API key), then
 * persist the audience/campaign/variants and log a campaign.drafted activity.
 */
export async function draftCampaign(args: DraftCampaignArgs): Promise<DraftCampaignResult> {
  const { orgId, clientId, name, channel, goal, audienceDefinition, brandVoice } = args
  const variantCount = Math.max(1, args.variantCount ?? 1)

  const members = await resolveAudience(orgId, clientId, audienceDefinition)
  const summary = summarizeAudience(members)

  const task: Task = channel === 'email' ? 'draft_email' : 'draft_sms'
  const system = buildSystemPrompt(channel, brandVoice)
  const prompt = buildUserPrompt(goal, summary, channel, audienceDefinition.segment)

  const forceFallback = process.env.RETENTIONOS_CONTENT_FALLBACK === '1'
  let usedFallback = false
  const drafts: Array<Draft & { model_used: string }> = []

  for (let i = 0; i < variantCount; i++) {
    try {
      if (forceFallback) {
        throw new Error('RETENTIONOS_CONTENT_FALLBACK=1 — forcing the template fallback.')
      }
      const raw = await generate({ task, system, messages: [{ role: 'user', content: prompt }] })
      const draft = channel === 'email' ? parseEmailDraft(raw) : parseSmsDraft(raw)
      drafts.push({ ...draft, model_used: modelRouting[task].model })
    } catch {
      // No API key configured in this environment (or the caller forced it): fall back to a
      // deterministic, grounded template draft so the rest of the pipeline still works.
      usedFallback = true
      drafts.push({ ...fallbackDraft(channel, summary, audienceDefinition.segment), model_used: 'template-fallback' })
    }
  }

  // Persist the audience definition so this campaign (and previewPersonalized, later) can
  // re-resolve the same membership from campaign.audience_id.
  const audience = await createAudience(orgId, {
    client_id: clientId,
    name: `${name} — audience`,
    definition: audienceDefinition as unknown as Record<string, unknown>,
    source: 'agent',
  })

  const campaign = await createCampaign(orgId, {
    client_id: clientId,
    name,
    channel,
    goal,
    status: 'draft',
    audience_id: audience.id,
    created_by_type: 'agent',
  })

  const variants: CampaignVariant[] = []
  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i]
    if (!draft) continue
    const variant = await createVariant(orgId, {
      campaign_id: campaign.id,
      label: VARIANT_LABELS[i] ?? String(i + 1),
      subject: draft.subject,
      body: draft.body,
      model_used: draft.model_used,
      status: 'draft',
    })
    variants.push(variant)
  }

  await logActivity(orgId, {
    client_id: clientId,
    actor_type: 'agent',
    verb: 'campaign.drafted',
    summary:
      `Drafted "${name}" (${channel}, ${goal}) for ${summary.audience_size} audience member(s)` +
      (usedFallback ? ' using the template fallback (no model available).' : '.'),
    data: {
      campaign_id: campaign.id,
      audience_id: audience.id,
      variant_ids: variants.map((v) => v.id),
      grounded_on: summary,
      used_fallback: usedFallback,
    },
  })

  return { campaign, variants, grounded_on: summary, used_fallback: usedFallback }
}

// ---------------------------------------------------------------------------
// personalize
// ---------------------------------------------------------------------------

/** Deterministic per-member discount code: SAVE15 plus a stable suffix from the customer id. */
function discountCodeFor(member: Pick<ResolvedAudienceMember, 'customer_id'>): string {
  const suffix = member.customer_id.replace(/-/g, '').slice(0, 4).toUpperCase()
  return suffix ? `SAVE15-${suffix}` : 'SAVE15'
}

/** Fill {{first_name}} and {{discount_code}} placeholders in a piece of copy for one member. */
export function personalize(
  text: string,
  member: Pick<ResolvedAudienceMember, 'customer_id' | 'first_name'>,
): string {
  return text
    .replace(/\{\{first_name\}\}/g, member.first_name || 'there')
    .replace(/\{\{discount_code\}\}/g, discountCodeFor(member))
}

// ---------------------------------------------------------------------------
// previewPersonalized
// ---------------------------------------------------------------------------

export interface PersonalizedVariantPreview {
  label: string
  subject?: string
  body?: string
}

export interface PersonalizedMemberPreview {
  customer_id: string
  first_name: string | null
  email: string | null
  variants: PersonalizedVariantPreview[]
}

export interface PreviewPersonalizedResult {
  campaign: Campaign
  members: PersonalizedMemberPreview[]
}

export interface PreviewPersonalizedArgs {
  orgId: string
  campaignId: string
  limit?: number
}

/** Read-only: load a campaign + its variants, re-resolve its audience, and return the first
 *  N members with each variant personalized for them — for a human review UI. */
export async function previewPersonalized(
  args: PreviewPersonalizedArgs,
): Promise<PreviewPersonalizedResult> {
  const { orgId, campaignId } = args
  const limit = args.limit ?? 3

  const campaign = await getCampaign(orgId, campaignId)
  if (!campaign) throw new Error(`No campaign found with id ${campaignId}.`)
  if (!campaign.audience_id) {
    throw new Error(`Campaign ${campaignId} has no associated audience to preview against.`)
  }

  const audience = await getAudience(orgId, campaign.audience_id)
  if (!audience) throw new Error(`No audience found with id ${campaign.audience_id}.`)

  const variants = await listVariants(orgId, campaignId)
  const members = await resolveAudience(
    orgId,
    campaign.client_id,
    audience.definition as unknown as AudienceDefinition,
  )

  const previewMembers: PersonalizedMemberPreview[] = members.slice(0, limit).map((member) => ({
    customer_id: member.customer_id,
    first_name: member.first_name,
    email: member.email,
    variants: variants.map((variant) => ({
      label: variant.label,
      subject: variant.subject ? personalize(variant.subject, member) : undefined,
      body: variant.body ? personalize(variant.body, member) : undefined,
    })),
  }))

  return { campaign, members: previewMembers }
}
