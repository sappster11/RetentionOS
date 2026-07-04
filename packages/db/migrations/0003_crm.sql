-- 0003_crm.sql
-- Phase 1 · task 1.1 — the CRM core: clients, contacts, channels, documents, activities,
-- integrations. This is the spine everything else plugs into (docs/03-data-model.md).
-- RLS in the same migration (P5).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.client_status      as enum ('prospect', 'onboarding', 'active', 'at_risk', 'churned', 'paused');
create type public.lifecycle_stage    as enum ('lead', 'trial', 'active', 'renewal', 'offboarding');
create type public.client_tier        as enum ('standard', 'premium', 'enterprise');
create type public.channel_kind       as enum ('slack', 'gdrive', 'gcal', 'notion', 'airtable', 'website', 'other');
create type public.actor_type         as enum ('user', 'agent', 'system');
create type public.integration_status as enum ('connected', 'error', 'disconnected');

-- ---------------------------------------------------------------------------
-- clients — the "accounts" (what currently lives in Airtable)
-- ---------------------------------------------------------------------------
create table public.clients (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  name             text not null,
  slug             text not null,
  status           public.client_status not null default 'prospect',
  lifecycle_stage  public.lifecycle_stage not null default 'lead',
  tier             public.client_tier not null default 'standard',
  health_score     int check (health_score between 0 and 100),
  owner_id         uuid references public.users(id) on delete set null,
  website          text,
  industry         text,
  contract_start   date,
  contract_end     date,
  mrr              numeric(12, 2),
  metadata         jsonb not null default '{}'::jsonb,
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, slug)
);
create index clients_org_idx    on public.clients (organization_id);
create index clients_status_idx on public.clients (organization_id, status);
create index clients_owner_idx  on public.clients (owner_id);
create trigger clients_set_updated_at
  before update on public.clients for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- contacts — people at a client
-- ---------------------------------------------------------------------------
create table public.contacts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  client_id        uuid not null references public.clients(id) on delete cascade,
  full_name        text not null,
  email            text,
  phone            text,
  title            text,
  role_type        text,
  is_primary       boolean not null default false,
  timezone         text,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index contacts_client_idx on public.contacts (client_id);
create index contacts_org_idx    on public.contacts (organization_id);
create trigger contacts_set_updated_at
  before update on public.contacts for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- channels — external "containers": linked Slack channels, drives, calendars…
-- ---------------------------------------------------------------------------
create table public.channels (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  client_id        uuid not null references public.clients(id) on delete cascade,
  kind             public.channel_kind not null,
  name             text not null,
  external_id      text,
  url              text,
  metadata         jsonb not null default '{}'::jsonb,
  last_synced_at   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index channels_client_idx on public.channels (client_id);
create index channels_org_idx    on public.channels (organization_id);
create trigger channels_set_updated_at
  before update on public.channels for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- documents — unstructured content; also the RAG anchor (embeddings point here)
-- ---------------------------------------------------------------------------
create table public.documents (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  client_id        uuid references public.clients(id) on delete cascade,   -- nullable: some docs are agency-wide
  title            text not null,
  source           text not null default 'upload',   -- upload | obsidian | slack | gdrive | generated
  source_ref       text,
  storage_path     text,
  content          text,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index documents_client_idx on public.documents (client_id);
create index documents_org_idx    on public.documents (organization_id);
create trigger documents_set_updated_at
  before update on public.documents for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- activities — unified timeline (notes, status changes, agent actions, sends…)
-- ---------------------------------------------------------------------------
create table public.activities (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  client_id        uuid references public.clients(id) on delete cascade,
  actor_type       public.actor_type not null default 'user',
  actor_id         uuid,
  verb             text not null,                    -- note.created | client.status_changed | ...
  summary          text,
  data             jsonb not null default '{}'::jsonb,
  occurred_at      timestamptz not null default now(),
  created_at       timestamptz not null default now()
);
create index activities_client_idx on public.activities (client_id, occurred_at desc);
create index activities_org_idx    on public.activities (organization_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- integrations — per-connector auth/config (secrets by reference, never plaintext)
-- ---------------------------------------------------------------------------
create table public.integrations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  client_id        uuid references public.clients(id) on delete cascade,   -- some integrations are per-client (Shopify/Klaviyo)
  provider         text not null,                    -- slack | google | shopify | klaviyo | resend | twilio | ...
  status           public.integration_status not null default 'disconnected',
  config           jsonb not null default '{}'::jsonb,
  secret_ref       text,
  connected_by     uuid references public.users(id) on delete set null,
  last_synced_at   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index integrations_org_idx on public.integrations (organization_id, provider);
create trigger integrations_set_updated_at
  before update on public.integrations for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-Level Security — visible/editable only within the caller's organization.
-- (Server-side service role bypasses RLS for sync jobs / MCP; see working agreement.)
-- ---------------------------------------------------------------------------
alter table public.clients      enable row level security;
alter table public.contacts     enable row level security;
alter table public.channels     enable row level security;
alter table public.documents    enable row level security;
alter table public.activities   enable row level security;
alter table public.integrations enable row level security;

create policy clients_rw on public.clients
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy contacts_rw on public.contacts
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy channels_rw on public.channels
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy documents_rw on public.documents
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy activities_rw on public.activities
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy integrations_select on public.integrations
  for select using (public.is_org_member(organization_id));
-- integrations writes stay service-role only (they carry secret references).
