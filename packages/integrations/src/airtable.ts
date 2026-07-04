// Airtable importer — the Airtable -> owned-Postgres migration path for the CRM core
// (clients/contacts/channels, migration 0003_crm.sql). Unlike Shopify/Klaviyo this isn't an
// ongoing two-way "connector" with a shared Connector shape (there's no customers/orders/
// products concept here) — it's a one-shot/periodic import, so it gets its own
// importFromFixture/importLive pair instead.
import { z } from 'zod'
import {
  createClient,
  createContact,
  linkChannel,
  queryOne,
  slugify,
  updateClient,
} from '@retentionos/db'
import type { ChannelKind, ClientStatus, ClientTier } from '@retentionos/db'

// ---------------------------------------------------------------------------
// Fixture shapes. Airtable's own schema is whatever the base's columns are; these mirror the
// RetentionOS "Clients" base described in docs/03-data-model.md (name/industry/status/tier/
// website on the Clients table, contacts/channels as separate tables linked back by name).
// ---------------------------------------------------------------------------

// Must match public.client_status / public.client_tier / public.channel_kind (0003_crm.sql) —
// duplicated here (rather than derived from the DB enums) because zod needs literal values to
// validate against, not just a TS type.
const CLIENT_STATUS_VALUES = [
  'prospect',
  'onboarding',
  'active',
  'at_risk',
  'churned',
  'paused',
] as const
const CLIENT_TIER_VALUES = ['standard', 'premium', 'enterprise'] as const
const CHANNEL_KIND_VALUES = [
  'slack',
  'gdrive',
  'gcal',
  'notion',
  'airtable',
  'website',
  'other',
] as const

const airtableClientSchema = z.object({
  name: z.string(),
  industry: z.string().nullable().optional(),
  status: z.enum(CLIENT_STATUS_VALUES).optional(),
  tier: z.enum(CLIENT_TIER_VALUES).optional(),
  website: z.string().nullable().optional(),
})

const airtableContactSchema = z.object({
  client_ref: z.string(),
  full_name: z.string(),
  email: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
})

const airtableChannelSchema = z.object({
  client_ref: z.string(),
  kind: z.enum(CHANNEL_KIND_VALUES),
  name: z.string(),
  url: z.string().nullable().optional(),
})

export const airtableFixtureSchema = z.object({
  clients: z.array(airtableClientSchema).default([]),
  contacts: z.array(airtableContactSchema).default([]),
  channels: z.array(airtableChannelSchema).default([]),
})

export type AirtableClientRecord = z.infer<typeof airtableClientSchema>
export type AirtableContactRecord = z.infer<typeof airtableContactSchema>
export type AirtableChannelRecord = z.infer<typeof airtableChannelSchema>
export type AirtableFixture = z.infer<typeof airtableFixtureSchema>

export interface AirtableCredentials {
  apiKey: string
  baseId: string
  table: string
}

export interface AirtableImportSummary {
  clients: number
  contacts: number
  channels: number
}

// ---------------------------------------------------------------------------
// Mapping / upsert (shared by importFromFixture and importLive)
// ---------------------------------------------------------------------------

async function upsertClients(
  orgId: string,
  clients: AirtableClientRecord[],
): Promise<{ count: number; clientIdByName: Map<string, string> }> {
  const clientIdByName = new Map<string, string>()
  let count = 0

  for (const c of clients) {
    const slug = slugify(c.name)
    const existing = await queryOne<{ id: string }>(
      `select id from public.clients where organization_id = $1 and slug = $2`,
      [orgId, slug],
    )

    let clientId: string
    if (existing) {
      const updated = await updateClient(orgId, existing.id, {
        status: c.status as ClientStatus | undefined,
        tier: c.tier as ClientTier | undefined,
        website: c.website ?? null,
        industry: c.industry ?? null,
      })
      clientId = updated?.id ?? existing.id
    } else {
      const created = await createClient(orgId, {
        name: c.name,
        status: c.status,
        tier: c.tier,
        website: c.website ?? undefined,
        industry: c.industry ?? undefined,
      })
      clientId = created.id
    }

    clientIdByName.set(c.name, clientId)
    count++
  }

  return { count, clientIdByName }
}

async function importContacts(
  orgId: string,
  contacts: AirtableContactRecord[],
  clientIdByName: Map<string, string>,
): Promise<number> {
  let count = 0
  for (const contact of contacts) {
    const clientId = clientIdByName.get(contact.client_ref)
    if (!clientId) {
      console.warn(
        `airtable: contact "${contact.full_name}" references unknown client "${contact.client_ref}", skipping`,
      )
      continue
    }
    // No unique constraint on contacts, so dedupe manually on (client, full_name, email) to
    // keep repeat imports idempotent.
    const existing = await queryOne<{ id: string }>(
      `select id from public.contacts
       where client_id = $1 and full_name = $2 and coalesce(email, '') = coalesce($3, '')`,
      [clientId, contact.full_name, contact.email ?? null],
    )
    if (existing) continue

    await createContact(orgId, {
      client_id: clientId,
      full_name: contact.full_name,
      email: contact.email ?? undefined,
      title: contact.title ?? undefined,
    })
    count++
  }
  return count
}

async function importChannels(
  orgId: string,
  channels: AirtableChannelRecord[],
  clientIdByName: Map<string, string>,
): Promise<number> {
  let count = 0
  for (const channel of channels) {
    const clientId = clientIdByName.get(channel.client_ref)
    if (!clientId) {
      console.warn(
        `airtable: channel "${channel.name}" references unknown client "${channel.client_ref}", skipping`,
      )
      continue
    }
    // No unique constraint on channels either — dedupe manually on (client, kind, name).
    const existing = await queryOne<{ id: string }>(
      `select id from public.channels where client_id = $1 and kind = $2::public.channel_kind and name = $3`,
      [clientId, channel.kind, channel.name],
    )
    if (existing) continue

    await linkChannel(orgId, {
      client_id: clientId,
      kind: channel.kind as ChannelKind,
      name: channel.name,
      url: channel.url ?? undefined,
    })
    count++
  }
  return count
}

async function applyAirtableFixture(
  orgId: string,
  fixture: AirtableFixture,
): Promise<AirtableImportSummary> {
  const { count: clientCount, clientIdByName } = await upsertClients(orgId, fixture.clients)
  const contactCount = await importContacts(orgId, fixture.contacts, clientIdByName)
  const channelCount = await importChannels(orgId, fixture.channels, clientIdByName)
  return { clients: clientCount, contacts: contactCount, channels: channelCount }
}

/** Upserts clients (by (organization_id, slug)) then their contacts + channels. */
export async function importFromFixture(
  orgId: string,
  fixture: AirtableFixture,
): Promise<AirtableImportSummary> {
  const parsed = airtableFixtureSchema.parse(fixture)
  return applyAirtableFixture(orgId, parsed)
}

// ---------------------------------------------------------------------------
// Live Airtable API fetch — requires an Airtable personal access token (data.records:read on
// the base) + baseId + table name. Not exercised in this environment (no credentials) but
// typechecks and reuses applyAirtableFixture above.
//
// Airtable's field names are whatever the base's columns are named, so this maps the RetentionOS
// "Clients" base convention: a `kind` + `client_ref` field marks a channel row, a `full_name` +
// `client_ref` field marks a contact row, everything else with a `name` field is a client row.
// A real migration would call importLive once per table (Clients, Contacts, Channels).
// ---------------------------------------------------------------------------

interface AirtableApiRecord {
  id: string
  fields: Record<string, unknown>
}

interface AirtableApiResponse {
  records: AirtableApiRecord[]
  offset?: string
}

async function fetchAirtableTable(
  apiKey: string,
  baseId: string,
  table: string,
): Promise<AirtableApiRecord[]> {
  const records: AirtableApiRecord[] = []
  let offset: string | undefined

  do {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`)
    if (offset) url.searchParams.set('offset', offset)
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } })
    if (!res.ok) {
      throw new Error(`Airtable API error ${res.status} for ${table}: ${await res.text()}`)
    }
    const body = (await res.json()) as AirtableApiResponse
    records.push(...body.records)
    offset = body.offset
  } while (offset)

  return records
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function mapAirtableRecordsToFixture(records: AirtableApiRecord[]): AirtableFixture {
  const clients: AirtableClientRecord[] = []
  const contacts: AirtableContactRecord[] = []
  const channels: AirtableChannelRecord[] = []

  for (const record of records) {
    const f = record.fields
    const clientRef = str(f.client_ref)
    const kind = str(f.kind)
    const name = str(f.name)
    const fullName = str(f.full_name)

    if (clientRef && kind && name) {
      channels.push({
        client_ref: clientRef,
        kind: CHANNEL_KIND_VALUES.includes(kind as (typeof CHANNEL_KIND_VALUES)[number])
          ? (kind as AirtableChannelRecord['kind'])
          : 'other',
        name,
        url: str(f.url),
      })
    } else if (clientRef && fullName) {
      contacts.push({
        client_ref: clientRef,
        full_name: fullName,
        email: str(f.email),
        title: str(f.title),
      })
    } else if (name) {
      const status = str(f.status)
      const tier = str(f.tier)
      clients.push({
        name,
        industry: str(f.industry),
        status: status && CLIENT_STATUS_VALUES.includes(status as (typeof CLIENT_STATUS_VALUES)[number])
          ? (status as AirtableClientRecord['status'])
          : undefined,
        tier: tier && CLIENT_TIER_VALUES.includes(tier as (typeof CLIENT_TIER_VALUES)[number])
          ? (tier as AirtableClientRecord['tier'])
          : undefined,
        website: str(f.website),
      })
    }
  }

  return { clients, contacts, channels }
}

/** requires an Airtable personal access token; imports one table's worth of records. */
export async function importLive(
  orgId: string,
  credentials: AirtableCredentials,
): Promise<AirtableImportSummary> {
  if (!credentials?.apiKey || !credentials?.baseId || !credentials?.table) {
    throw new Error('Airtable importLive requires { apiKey, baseId, table }.')
  }
  const records = await fetchAirtableTable(credentials.apiKey, credentials.baseId, credentials.table)
  const fixture = mapAirtableRecordsToFixture(records)
  return applyAirtableFixture(orgId, fixture)
}

export const airtableImporter = {
  provider: 'airtable',
  importFromFixture,
  importLive,
}
