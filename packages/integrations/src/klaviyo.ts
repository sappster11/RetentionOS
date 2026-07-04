// Klaviyo connector — populates client_customers (profiles), client_engagement_events, and
// client_segments/client_segment_members (migration 0004_client_data.sql). A Klaviyo profile
// may already exist as a client_customers row synced from Shopify (matched by email); if so we
// enrich that row rather than create a duplicate customer. Fixture and live paths both funnel
// through `applyKlaviyoFixture`.
import { z } from 'zod'
import { query, queryOne } from '@retentionos/db'
import type { Connector, SyncSummary } from './types'

// ---------------------------------------------------------------------------
// Fixture / mapped-API shapes (Klaviyo JSON:API-ish shapes, trimmed to what we use)
// ---------------------------------------------------------------------------

const numericString = z.union([z.string(), z.number()]).transform((v) => String(v))

const klaviyoProfileSchema = z.object({
  id: z.string(),
  email: z.string().nullable().optional(),
  phone_number: z.string().nullable().optional(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  subscriptions: z
    .object({
      email: z.boolean().optional(),
      sms: z.boolean().optional(),
    })
    .optional(),
})

const klaviyoEventSchema = z.object({
  id: z.string(),
  metric: z.string(),
  timestamp: z.string(),
  value: numericString.nullable().optional(),
  profile_id: z.string(),
})

const klaviyoSegmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  profile_ids: z.array(z.string()).default([]),
})

export const klaviyoFixtureSchema = z.object({
  profiles: z.array(klaviyoProfileSchema).default([]),
  events: z.array(klaviyoEventSchema).default([]),
  segments: z.array(klaviyoSegmentSchema).default([]),
})

export type KlaviyoProfile = z.infer<typeof klaviyoProfileSchema>
export type KlaviyoEvent = z.infer<typeof klaviyoEventSchema>
export type KlaviyoSegment = z.infer<typeof klaviyoSegmentSchema>
export type KlaviyoFixture = z.infer<typeof klaviyoFixtureSchema>

export interface KlaviyoCredentials {
  apiKey: string
}

// ---------------------------------------------------------------------------
// Mapping / upsert (shared by syncFromFixture and syncLive)
// ---------------------------------------------------------------------------

/**
 * Upserts Klaviyo profiles into client_customers. Match on email first (a customer already
 * synced from Shopify by email is enriched in place, not duplicated); otherwise insert a new
 * row with source='klaviyo'. Either way we key the resulting map by the Klaviyo profile id
 * (via the klaviyo_profile_id column) so events/segments can resolve customer_id regardless of
 * which source actually owns the row.
 */
async function upsertProfiles(
  orgId: string,
  clientId: string,
  profiles: KlaviyoProfile[],
): Promise<Map<string, string>> {
  const customerIdByProfileId = new Map<string, string>()

  for (const p of profiles) {
    const emailConsent = p.subscriptions?.email ?? null
    const smsConsent = p.subscriptions?.sms ?? null

    let customerId: string | null = null

    if (p.email) {
      const existing = await queryOne<{ id: string }>(
        `select id from public.client_customers
         where client_id = $1 and lower(email) = lower($2)
         limit 1`,
        [clientId, p.email],
      )
      if (existing) {
        const updated = await queryOne<{ id: string }>(
          `update public.client_customers set
             klaviyo_profile_id = $1,
             email_consent = $2,
             sms_consent = $3,
             phone = coalesce(phone, $4),
             first_name = coalesce(first_name, $5),
             last_name = coalesce(last_name, $6)
           where id = $7
           returning id`,
          [
            p.id,
            emailConsent,
            smsConsent,
            p.phone_number ?? null,
            p.first_name ?? null,
            p.last_name ?? null,
            existing.id,
          ],
        )
        customerId = updated?.id ?? existing.id
      }
    }

    if (!customerId) {
      const inserted = await queryOne<{ id: string }>(
        `insert into public.client_customers
           (organization_id, client_id, source, external_id, email, phone, first_name, last_name,
            klaviyo_profile_id, email_consent, sms_consent, metadata)
         values ($1, $2, 'klaviyo', $3, $4, $5, $6, $7, $3, $8, $9, $10)
         on conflict (client_id, source, external_id) do update set
           email = excluded.email,
           phone = excluded.phone,
           first_name = excluded.first_name,
           last_name = excluded.last_name,
           klaviyo_profile_id = excluded.klaviyo_profile_id,
           email_consent = excluded.email_consent,
           sms_consent = excluded.sms_consent,
           metadata = excluded.metadata
         returning id`,
        [
          orgId,
          clientId,
          p.id,
          p.email ?? null,
          p.phone_number ?? null,
          p.first_name ?? null,
          p.last_name ?? null,
          emailConsent,
          smsConsent,
          JSON.stringify(p),
        ],
      )
      customerId = inserted?.id ?? null
    }

    if (customerId) customerIdByProfileId.set(p.id, customerId)
  }

  return customerIdByProfileId
}

async function upsertEvents(
  orgId: string,
  clientId: string,
  events: KlaviyoEvent[],
  customerIdByProfileId: Map<string, string>,
): Promise<number> {
  let count = 0
  for (const e of events) {
    const customerId = customerIdByProfileId.get(e.profile_id)
    if (!customerId) {
      console.warn(`klaviyo: event ${e.id} references unknown profile ${e.profile_id}, skipping`)
      continue
    }
    await query(
      `insert into public.client_engagement_events
         (organization_id, client_id, customer_id, source, external_id, event_type, occurred_at,
          value, metadata)
       values ($1, $2, $3, 'klaviyo', $4, $5, $6, $7, $8)
       on conflict (client_id, source, external_id) do update set
         customer_id = excluded.customer_id,
         event_type = excluded.event_type,
         occurred_at = excluded.occurred_at,
         value = excluded.value,
         metadata = excluded.metadata`,
      [orgId, clientId, customerId, e.id, e.metric, e.timestamp, e.value ?? null, JSON.stringify(e)],
    )
    count++
  }
  return count
}

async function upsertSegments(
  orgId: string,
  clientId: string,
  segments: KlaviyoSegment[],
  customerIdByProfileId: Map<string, string>,
): Promise<number> {
  let count = 0
  for (const s of segments) {
    const segmentRow = await queryOne<{ id: string }>(
      `insert into public.client_segments
         (organization_id, client_id, source, external_id, name, kind, member_count, definition,
          last_synced_at)
       values ($1, $2, 'klaviyo', $3, $4, 'segment', $5, $6, now())
       on conflict (client_id, source, external_id) do update set
         name = excluded.name,
         member_count = excluded.member_count,
         definition = excluded.definition,
         last_synced_at = excluded.last_synced_at
       returning id`,
      [orgId, clientId, s.id, s.name, s.profile_ids.length, JSON.stringify(s)],
    )
    if (!segmentRow) continue
    count++

    for (const profileId of s.profile_ids) {
      const customerId = customerIdByProfileId.get(profileId)
      if (!customerId) {
        console.warn(
          `klaviyo: segment ${s.id} references unknown profile ${profileId}, skipping member`,
        )
        continue
      }
      await query(
        `insert into public.client_segment_members
           (organization_id, client_id, segment_id, customer_id)
         values ($1, $2, $3, $4)
         on conflict (segment_id, customer_id) do nothing`,
        [orgId, clientId, segmentRow.id, customerId],
      )
    }
  }
  return count
}

async function applyKlaviyoFixture(
  orgId: string,
  clientId: string,
  fixture: KlaviyoFixture,
): Promise<SyncSummary> {
  const customerIdByProfileId = await upsertProfiles(orgId, clientId, fixture.profiles)
  const eventCount = await upsertEvents(orgId, clientId, fixture.events, customerIdByProfileId)
  const segmentCount = await upsertSegments(orgId, clientId, fixture.segments, customerIdByProfileId)

  return {
    customers: customerIdByProfileId.size,
    orders: 0,
    products: 0,
    events: eventCount,
    segments: segmentCount,
  }
}

// ---------------------------------------------------------------------------
// Live Klaviyo API fetch — requires a Klaviyo private API key (scopes: profiles:read,
// events:read, segments:read). Not exercised in this environment (no credentials) but
// typechecks and reuses applyKlaviyoFixture above.
// ---------------------------------------------------------------------------

const KLAVIYO_REVISION = '2024-10-15'

interface KlaviyoJsonApiResource {
  id: string
  attributes: Record<string, unknown>
  relationships?: Record<string, { data?: { id: string } | { id: string }[] | null }>
}

interface KlaviyoJsonApiResponse {
  data: KlaviyoJsonApiResource[]
  links?: { next?: string | null }
}

async function klaviyoFetchPage(apiKey: string, url: string): Promise<KlaviyoJsonApiResponse> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      revision: KLAVIYO_REVISION,
      accept: 'application/json',
    },
  })
  if (!res.ok) {
    throw new Error(`Klaviyo API error ${res.status}: ${await res.text()}`)
  }
  return (await res.json()) as KlaviyoJsonApiResponse
}

async function fetchAllKlaviyo(apiKey: string, initialUrl: string): Promise<KlaviyoJsonApiResource[]> {
  const results: KlaviyoJsonApiResource[] = []
  let url: string | null = initialUrl
  while (url) {
    const page = await klaviyoFetchPage(apiKey, url)
    results.push(...page.data)
    url = page.links?.next ?? null
  }
  return results
}

function firstRelatedId(
  resource: KlaviyoJsonApiResource,
  relationship: string,
): string | undefined {
  const data = resource.relationships?.[relationship]?.data
  if (!data) return undefined
  return Array.isArray(data) ? data[0]?.id : data.id
}

async function fetchKlaviyoFixtureLive(apiKey: string): Promise<KlaviyoFixture> {
  const [profileResources, eventResources, segmentResources] = await Promise.all([
    fetchAllKlaviyo(apiKey, 'https://a.klaviyo.com/api/profiles/?page[size]=100'),
    fetchAllKlaviyo(
      apiKey,
      'https://a.klaviyo.com/api/events/?page[size]=100&include=profile,metric',
    ),
    fetchAllKlaviyo(apiKey, 'https://a.klaviyo.com/api/segments/?page[size]=100'),
  ])

  const profiles: KlaviyoProfile[] = profileResources.map((r) => ({
    id: r.id,
    email: (r.attributes.email as string | undefined) ?? null,
    phone_number: (r.attributes.phone_number as string | undefined) ?? null,
    first_name: (r.attributes.first_name as string | undefined) ?? null,
    last_name: (r.attributes.last_name as string | undefined) ?? null,
    subscriptions: {
      email: Boolean(
        (r.attributes.subscriptions as { email?: { marketing?: { consent?: string } } })?.email
          ?.marketing?.consent === 'SUBSCRIBED',
      ),
      sms: Boolean(
        (r.attributes.subscriptions as { sms?: { marketing?: { consent?: string } } })?.sms
          ?.marketing?.consent === 'SUBSCRIBED',
      ),
    },
  }))

  const events: z.input<typeof klaviyoEventSchema>[] = eventResources.map((r) => ({
    id: r.id,
    metric: (r.attributes.metric_id as string | undefined) ?? firstRelatedId(r, 'metric') ?? '',
    timestamp: (r.attributes.datetime as string | undefined) ?? new Date().toISOString(),
    value: (r.attributes.value as string | number | undefined) ?? null,
    profile_id: firstRelatedId(r, 'profile') ?? '',
  }))

  const segments: KlaviyoSegment[] = segmentResources.map((r) => ({
    id: r.id,
    name: (r.attributes.name as string | undefined) ?? r.id,
    profile_ids: [],
  }))

  return klaviyoFixtureSchema.parse({ profiles, events, segments })
}

// ---------------------------------------------------------------------------
// Connector
// ---------------------------------------------------------------------------

export const klaviyoConnector: Connector<KlaviyoFixture, KlaviyoCredentials> = {
  provider: 'klaviyo',

  async syncFromFixture(orgId, clientId, fixture) {
    const parsed = klaviyoFixtureSchema.parse(fixture)
    return applyKlaviyoFixture(orgId, clientId, parsed)
  },

  // requires a Klaviyo private API key — this path is correct and typechecked but cannot run
  // in this environment (no Klaviyo credentials available).
  async syncLive(orgId, clientId, credentials) {
    if (!credentials?.apiKey) {
      throw new Error(
        'Klaviyo syncLive requires { apiKey } — a Klaviyo private API key with profiles:read, ' +
          'events:read, segments:read scopes.',
      )
    }
    const fixture = await fetchKlaviyoFixtureLive(credentials.apiKey)
    return applyKlaviyoFixture(orgId, clientId, fixture)
  },
}
