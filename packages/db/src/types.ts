// Row types for the CRM core. These mirror the columns in migration 0003_crm.sql.
// (When Supabase is connected, `pnpm --filter @retentionos/db gen-types` can generate a
// fuller set; these hand-written types keep the data layer usable offline in the meantime.)

export type ClientStatus =
  | 'prospect'
  | 'onboarding'
  | 'active'
  | 'at_risk'
  | 'churned'
  | 'paused'

export type LifecycleStage = 'lead' | 'trial' | 'active' | 'renewal' | 'offboarding'
export type ClientTier = 'standard' | 'premium' | 'enterprise'
export type ChannelKind =
  | 'slack'
  | 'gdrive'
  | 'gcal'
  | 'notion'
  | 'airtable'
  | 'website'
  | 'other'
export type ActorType = 'user' | 'agent' | 'system'

export interface Organization {
  id: string
  name: string
  slug: string
  created_at: string
}

export interface Client {
  id: string
  organization_id: string
  name: string
  slug: string
  status: ClientStatus
  lifecycle_stage: LifecycleStage
  tier: ClientTier
  health_score: number | null
  owner_id: string | null
  website: string | null
  industry: string | null
  contract_start: string | null
  contract_end: string | null
  mrr: string | null
  metadata: Record<string, unknown>
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface Contact {
  id: string
  organization_id: string
  client_id: string
  full_name: string
  email: string | null
  phone: string | null
  title: string | null
  role_type: string | null
  is_primary: boolean
  timezone: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface Channel {
  id: string
  organization_id: string
  client_id: string
  kind: ChannelKind
  name: string
  external_id: string | null
  url: string | null
  metadata: Record<string, unknown>
  last_synced_at: string | null
  created_at: string
  updated_at: string
}

export interface Document {
  id: string
  organization_id: string
  client_id: string | null
  title: string
  source: string
  source_ref: string | null
  storage_path: string | null
  content: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface Activity {
  id: string
  organization_id: string
  client_id: string | null
  actor_type: ActorType
  actor_id: string | null
  verb: string
  summary: string | null
  data: Record<string, unknown>
  occurred_at: string
  created_at: string
}
