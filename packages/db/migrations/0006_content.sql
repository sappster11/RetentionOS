-- 0006_content.sql
-- Phase 4 · task 4.1 — the content engine data foundation: audiences (queries against the
-- retention analytics from 0004_client_data.sql, not stored membership lists), templates,
-- campaigns + variants, and sent messages (docs/03-data-model.md, "Content engine"). RLS in
-- the same migration (P5). Reuses public.actor_type (0003) for campaigns.created_by_type.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.campaign_channel  as enum ('email', 'sms');
create type public.campaign_goal     as enum ('winback', 'onboarding', 'retention', 'reengagement', 'announcement');
create type public.campaign_status   as enum ('draft', 'in_review', 'approved', 'scheduled', 'sent', 'archived');
create type public.message_provider  as enum ('resend', 'twilio', 'client_esp');
create type public.message_status    as enum ('queued', 'sent', 'delivered', 'failed', 'bounced');

-- ---------------------------------------------------------------------------
-- audiences — NOT stored membership lists. A saved query (definition jsonb) evaluated against
-- client_customer_metrics / client_customers at send time; see packages/db/src/audiences.ts#
-- resolveAudience for the query builder this jsonb feeds.
-- ---------------------------------------------------------------------------
create table public.audiences (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  client_id        uuid not null references public.clients(id) on delete cascade,
  name             text not null,
  definition       jsonb not null default '{}'::jsonb,
  source           text not null default 'internal',   -- internal | klaviyo | ...
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index audiences_org_idx    on public.audiences (organization_id);
create index audiences_client_idx on public.audiences (client_id);
create trigger audiences_set_updated_at
  before update on public.audiences for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- templates — reusable content, agency-wide (client_id null) or client-specific
-- ---------------------------------------------------------------------------
create table public.templates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  client_id        uuid references public.clients(id) on delete cascade,   -- nullable: agency-wide templates
  channel          public.campaign_channel not null,
  name             text not null,
  subject          text,
  body             text,
  variables        jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index templates_org_idx     on public.templates (organization_id);
create index templates_client_idx  on public.templates (client_id);
create index templates_channel_idx on public.templates (organization_id, channel);
create trigger templates_set_updated_at
  before update on public.templates for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- campaigns — a send targeting one audience, in one channel, toward one goal
-- ---------------------------------------------------------------------------
create table public.campaigns (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  client_id        uuid not null references public.clients(id) on delete cascade,
  name             text not null,
  channel          public.campaign_channel not null,
  goal             public.campaign_goal not null,
  status           public.campaign_status not null default 'draft',
  audience_id      uuid references public.audiences(id) on delete set null,
  created_by_type  public.actor_type not null default 'user',
  created_by_id    uuid,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index campaigns_org_idx      on public.campaigns (organization_id);
create index campaigns_client_idx   on public.campaigns (client_id);
create index campaigns_audience_idx on public.campaigns (audience_id);
create index campaigns_status_idx   on public.campaigns (organization_id, status);
create trigger campaigns_set_updated_at
  before update on public.campaigns for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- campaign_variants — A/B copy variants of a campaign (human- or model-authored)
-- ---------------------------------------------------------------------------
create table public.campaign_variants (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  campaign_id            uuid not null references public.campaigns(id) on delete cascade,
  label                  text not null default 'A',
  subject                text,
  body                   text,
  personalization_spec   jsonb not null default '{}'::jsonb,
  model_used             text,
  status                 text not null default 'draft',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index campaign_variants_org_idx      on public.campaign_variants (organization_id);
create index campaign_variants_campaign_idx on public.campaign_variants (campaign_id);
create trigger campaign_variants_set_updated_at
  before update on public.campaign_variants for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- messages — one row per rendered send, to one customer. Immutable send record (delivery
-- status is updated by provider webhooks, but the rendered content never changes), so no
-- updated_at trigger — mirrors public.client_engagement_events (0004).
-- ---------------------------------------------------------------------------
create table public.messages (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  campaign_id       uuid references public.campaigns(id) on delete set null,
  client_id         uuid not null references public.clients(id) on delete cascade,
  customer_id       uuid references public.client_customers(id) on delete set null,
  channel           public.campaign_channel not null,
  to_address        text,
  rendered_subject  text,
  rendered_body     text,
  provider          public.message_provider,
  provider_ref      text,
  status            public.message_status not null default 'queued',
  sent_at           timestamptz,
  created_at        timestamptz not null default now()
);
create index messages_org_idx      on public.messages (organization_id);
create index messages_client_idx   on public.messages (client_id);
create index messages_campaign_idx on public.messages (campaign_id);

-- ---------------------------------------------------------------------------
-- Row-Level Security — visible/editable only within the caller's organization.
-- ---------------------------------------------------------------------------
alter table public.audiences         enable row level security;
alter table public.templates         enable row level security;
alter table public.campaigns         enable row level security;
alter table public.campaign_variants enable row level security;
alter table public.messages          enable row level security;

create policy audiences_rw on public.audiences
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy templates_rw on public.templates
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy campaigns_rw on public.campaigns
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy campaign_variants_rw on public.campaign_variants
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy messages_rw on public.messages
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
