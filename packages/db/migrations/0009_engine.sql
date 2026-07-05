-- 0009_engine.sql
-- Phase A · Engine core — the Airtable-class runtime meta-schema.
--
-- Users AND agents create tables/fields/records/views at RUNTIME (never a deploy). The
-- purpose-built retention schema is now DATA, not columns. Everything here is scoped to an
-- organization and protected by RLS via public.is_org_member() (from 0001), same pattern
-- as every other client-data table in this repo.
--
-- Design notes:
--   * engine_records.values is jsonb keyed by FIELD ID (a uuid string), never field name,
--     so renaming a field is free and never rewrites record data.
--   * Select field choices live in engine_fields.options jsonb: {choices:[{id,name,color}]}.
--   * engine_views.config holds {filters, sorts, visibleFieldIds, groupByFieldId}. Only the
--     grid view is rendered in Phase A, but the schema already supports kanban.
--   * Every record create/update/delete writes an engine_record_revisions row with the
--     actor (user|agent|api) and a per-field diff. This is the free-over-Airtable audit
--     trail + future stage-change history.

-- ---------------------------------------------------------------------------
-- Actor provenance — who created / mutated a piece of schema or data.
-- Distinct from 0001's membership_role: this is human-vs-agent-vs-api attribution.
-- ---------------------------------------------------------------------------
create type public.engine_actor_type as enum ('user', 'agent', 'api');

-- ---------------------------------------------------------------------------
-- engine_tables — a user/agent-defined table ("Clients", "Sales Pipeline", …).
-- ---------------------------------------------------------------------------
create table public.engine_tables (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  name             text not null,
  slug             text not null,
  icon             text,
  description      text,
  position         double precision not null default 0,
  created_by_type  public.engine_actor_type not null default 'user',
  created_by_id    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, slug)
);
create index engine_tables_org_idx on public.engine_tables (organization_id, position);
create trigger engine_tables_set_updated_at
  before update on public.engine_tables
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- engine_fields — a column definition on an engine_table.
-- options jsonb carries type-specific config: for select fields
-- {choices:[{id,name,color}]}, empty {} for scalar types.
-- ---------------------------------------------------------------------------
create table public.engine_fields (
  id               uuid primary key default gen_random_uuid(),
  table_id         uuid not null references public.engine_tables(id) on delete cascade,
  name             text not null,
  type             text not null,
  options          jsonb not null default '{}'::jsonb,
  position         double precision not null default 0,
  required         boolean not null default false,
  created_by_type  public.engine_actor_type not null default 'user',
  created_by_id    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index engine_fields_table_idx on public.engine_fields (table_id, position);
create trigger engine_fields_set_updated_at
  before update on public.engine_fields
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- engine_records — a row in an engine_table. `values` is jsonb keyed by FIELD ID.
-- organization_id is denormalized here (not just via table_id) so RLS and the hot
-- query path stay a single-table check without a join.
-- ---------------------------------------------------------------------------
create table public.engine_records (
  id               uuid primary key default gen_random_uuid(),
  table_id         uuid not null references public.engine_tables(id) on delete cascade,
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  values           jsonb not null default '{}'::jsonb,
  position         double precision not null default 0,
  created_by_type  public.engine_actor_type not null default 'user',
  created_by_id    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index engine_records_table_created_idx on public.engine_records (table_id, created_at);
create index engine_records_values_gin_idx on public.engine_records using gin (values);
create trigger engine_records_set_updated_at
  before update on public.engine_records
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- engine_views — a saved way to look at a table (grid | kanban).
-- config jsonb: {filters:[...], sorts:[...], visibleFieldIds:[...], groupByFieldId}.
-- ---------------------------------------------------------------------------
create table public.engine_views (
  id               uuid primary key default gen_random_uuid(),
  table_id         uuid not null references public.engine_tables(id) on delete cascade,
  name             text not null,
  type             text not null default 'grid',
  config           jsonb not null default '{}'::jsonb,
  position         double precision not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index engine_views_table_idx on public.engine_views (table_id, position);
create trigger engine_views_set_updated_at
  before update on public.engine_views
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- engine_record_revisions — append-only audit trail. One row per record mutation
-- (create/update/delete), with actor attribution and a per-field diff:
--   diff = { "<fieldId>": { "from": <old>, "to": <new> }, ... }
-- On create, `from` is null for each field; on delete, `to` is null.
-- ---------------------------------------------------------------------------
create table public.engine_record_revisions (
  id               uuid primary key default gen_random_uuid(),
  record_id        uuid not null,
  table_id         uuid not null references public.engine_tables(id) on delete cascade,
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  actor_type       public.engine_actor_type not null default 'user',
  actor_id         text,
  op               text not null,  -- 'create' | 'update' | 'delete'
  diff             jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
-- record_id is NOT a FK: revisions survive the record they describe (delete audit trail).
create index engine_record_revisions_record_idx on public.engine_record_revisions (record_id);
create index engine_record_revisions_table_idx  on public.engine_record_revisions (table_id, created_at);

-- ---------------------------------------------------------------------------
-- Row-Level Security — every engine table is org-scoped via is_org_member() (0001).
-- engine_fields / engine_views have no org column; they inherit tenancy through their
-- parent engine_table, so their policies check membership of the parent's org.
-- Local dev connects as superuser (bypasses RLS); these bind once on Supabase w/ auth.
-- ---------------------------------------------------------------------------
alter table public.engine_tables           enable row level security;
alter table public.engine_fields           enable row level security;
alter table public.engine_records          enable row level security;
alter table public.engine_views            enable row level security;
alter table public.engine_record_revisions enable row level security;

create policy engine_tables_rw on public.engine_tables
  for all using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy engine_fields_rw on public.engine_fields
  for all using (
    exists (
      select 1 from public.engine_tables t
      where t.id = engine_fields.table_id and public.is_org_member(t.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.engine_tables t
      where t.id = engine_fields.table_id and public.is_org_member(t.organization_id)
    )
  );

create policy engine_records_rw on public.engine_records
  for all using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy engine_views_rw on public.engine_views
  for all using (
    exists (
      select 1 from public.engine_tables t
      where t.id = engine_views.table_id and public.is_org_member(t.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.engine_tables t
      where t.id = engine_views.table_id and public.is_org_member(t.organization_id)
    )
  );

-- Revisions are append-only from the app's perspective; RLS restricts reads to org members.
create policy engine_record_revisions_ro on public.engine_record_revisions
  for select using (public.is_org_member(organization_id));

create policy engine_record_revisions_insert on public.engine_record_revisions
  for insert with check (public.is_org_member(organization_id));
