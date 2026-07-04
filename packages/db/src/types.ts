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

// ---------------------------------------------------------------------------
// Client commerce & engagement data (Phase 3 — Shopify + Klaviyo mirrors).
// These mirror the columns in migration 0004_client_data.sql.
// ---------------------------------------------------------------------------

/**
 * A customer's retention lifecycle, computed into client_customer_metrics.
 * Distinct from `LifecycleStage` above (that one is the CRM client's lifecycle).
 */
export type LifecycleStageCustomer = 'new' | 'active' | 'at_risk' | 'churned' | 'won_back' | 'vip'

export interface ClientCustomer {
  id: string
  organization_id: string
  client_id: string
  source: string
  external_id: string
  email: string | null
  phone: string | null
  first_name: string | null
  last_name: string | null
  first_order_at: string | null
  last_order_at: string | null
  orders_count: number
  total_spent: string
  klaviyo_profile_id: string | null
  email_consent: boolean | null
  sms_consent: boolean | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface ClientOrder {
  id: string
  organization_id: string
  client_id: string
  customer_id: string
  source: string
  external_id: string
  order_number: string | null
  total: string
  currency: string
  financial_status: string | null
  fulfillment_status: string | null
  ordered_at: string
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface ClientOrderItem {
  id: string
  organization_id: string
  client_id: string
  order_id: string
  product_external_id: string | null
  product_title: string | null
  variant_title: string | null
  quantity: number
  price: string
  metadata: Record<string, unknown>
  created_at: string
}

export interface ClientProduct {
  id: string
  organization_id: string
  client_id: string
  source: string
  external_id: string
  title: string
  product_type: string | null
  vendor: string | null
  price: string | null
  status: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface ClientEngagementEvent {
  id: string
  organization_id: string
  client_id: string
  customer_id: string
  source: string
  external_id: string
  event_type: string
  occurred_at: string
  campaign_ref: string | null
  flow_ref: string | null
  value: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export interface ClientSegment {
  id: string
  organization_id: string
  client_id: string
  source: string
  external_id: string
  name: string
  kind: string | null
  member_count: number
  definition: Record<string, unknown>
  last_synced_at: string | null
  created_at: string
  updated_at: string
}

export interface ClientSegmentMember {
  id: string
  organization_id: string
  client_id: string
  segment_id: string
  customer_id: string
  added_at: string
  created_at: string
}

// ---------------------------------------------------------------------------
// Derived retention analytics (computed, refreshed on a schedule — see
// packages/db/src/clientData.ts#recomputeAnalytics).
// ---------------------------------------------------------------------------

export interface ClientCustomerMetric {
  id: string
  organization_id: string
  client_id: string
  customer_id: string
  recency_days: number | null
  frequency: number
  monetary: string
  rfm_recency: number
  rfm_frequency: number
  rfm_monetary: number
  aov: string | null
  predicted_ltv: string | null
  lifecycle_stage: LifecycleStageCustomer
  churn_risk: string
  next_order_estimate: string | null
  computed_at: string
  created_at: string
}

export interface ClientCohort {
  id: string
  organization_id: string
  client_id: string
  cohort_key: string
  period_index: number
  customers: number
  retained: number
  revenue: string
  computed_at: string
  created_at: string
}

// ---------------------------------------------------------------------------
// Agentic project management (Phase 2). These mirror the columns in migration
// 0005_pm.sql.
// ---------------------------------------------------------------------------

export type ProjectStatus = 'planned' | 'active' | 'on_hold' | 'done' | 'cancelled'
export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'review' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'

export interface Project {
  id: string
  organization_id: string
  client_id: string | null
  name: string
  status: ProjectStatus
  owner_id: string | null
  starts_on: string | null
  due_on: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface Task {
  id: string
  organization_id: string
  project_id: string | null
  client_id: string | null
  title: string
  details: string | null
  status: TaskStatus
  priority: TaskPriority
  assignee_id: string | null
  due_on: string | null
  completed_at: string | null
  created_by_type: ActorType
  created_by_id: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface TaskDependency {
  id: string
  organization_id: string
  task_id: string
  depends_on_task_id: string
  created_at: string
}

export interface TaskComment {
  id: string
  organization_id: string
  task_id: string
  author_type: ActorType
  author_id: string | null
  body: string
  created_at: string
}

// ---------------------------------------------------------------------------
// Content engine (Phase 4). These mirror the columns in migration 0006_content.sql.
// ---------------------------------------------------------------------------

export type CampaignChannel = 'email' | 'sms'
export type CampaignGoal =
  | 'winback'
  | 'onboarding'
  | 'retention'
  | 'reengagement'
  | 'announcement'
export type CampaignStatus =
  | 'draft'
  | 'in_review'
  | 'approved'
  | 'scheduled'
  | 'sent'
  | 'archived'
export type MessageProvider = 'resend' | 'twilio' | 'client_esp'
export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'failed' | 'bounced'

export interface Audience {
  id: string
  organization_id: string
  client_id: string
  name: string
  definition: Record<string, unknown>
  source: string
  created_at: string
  updated_at: string
}

export interface Template {
  id: string
  organization_id: string
  client_id: string | null
  channel: CampaignChannel
  name: string
  subject: string | null
  body: string | null
  variables: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface Campaign {
  id: string
  organization_id: string
  client_id: string
  name: string
  channel: CampaignChannel
  goal: CampaignGoal
  status: CampaignStatus
  audience_id: string | null
  created_by_type: ActorType
  created_by_id: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface CampaignVariant {
  id: string
  organization_id: string
  campaign_id: string
  label: string
  subject: string | null
  body: string | null
  personalization_spec: Record<string, unknown>
  model_used: string | null
  status: string
  created_at: string
  updated_at: string
}

export interface Message {
  id: string
  organization_id: string
  campaign_id: string | null
  client_id: string
  customer_id: string | null
  channel: CampaignChannel
  to_address: string | null
  rendered_subject: string | null
  rendered_body: string | null
  provider: MessageProvider | null
  provider_ref: string | null
  status: MessageStatus
  sent_at: string | null
  created_at: string
}

/** Result row for resolveAudience — a customer matched by an audience's saved query,
 *  joined from client_customers + client_customer_metrics (0004_client_data.sql). */
export interface ResolvedAudienceMember {
  customer_id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  recency_days: number | null
  frequency: number
  monetary: string
  churn_risk: string
  lifecycle_stage: LifecycleStageCustomer
}

// ---------------------------------------------------------------------------
// Reporting (Phase 5). Mirrors the columns in migration 0007_reporting.sql. See
// packages/db/src/reporting.ts for the health-score heuristic and snapshot/read functions.
// ---------------------------------------------------------------------------

export interface MetricSnapshot {
  id: string
  organization_id: string
  client_id: string | null
  metric_key: string
  value: string
  period: string
  captured_at: string
  metadata: Record<string, unknown>
  created_at: string
}

/** The v1 health-score heuristic's inputs — see reporting.ts#computeClientHealthDrivers. */
export interface HealthDrivers {
  activeShare: number
  churnShare: number
  riskShare: number
  overdue: number
}

/** Output of computeHealthScores — one row per client, with the inputs that drove the score. */
export interface ClientHealth {
  client_id: string
  name: string
  health_score: number | null
  drivers: HealthDrivers | null
}
