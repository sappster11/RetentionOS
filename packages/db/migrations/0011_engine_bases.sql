-- 0011_engine_bases.sql
-- Bases — workspace grouping of engine tables (Airtable-style "bases"). The Sales CRM's
-- tables and the Client Hub's tables stop sharing one flat tab strip: each base owns a
-- set of tables, and the UI shows one base's tables at a time.
--
-- Design notes:
--   * engine_tables.base_id is NULLABLE. Ungrouped tables are legal (they render under a
--     default "Workspace" group in the UI), so existing deployments keep working before
--     the seeds backfill base_id on their tables.
--   * on delete set null: the engine's deleteBase refuses to delete a non-empty base
--     (bad_input), so this FK action is a safety net, not a code path — if a base row is
--     ever removed out-of-band, its tables degrade to ungrouped instead of erroring.
--   * Same org-scoped RLS pattern as engine_tables (0009): is_org_member() from 0001.

-- ---------------------------------------------------------------------------
-- engine_bases — a user/agent-defined workspace of tables ("Sales CRM", "Client Hub").
-- ---------------------------------------------------------------------------
create table public.engine_bases (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  name             text not null,
  slug             text not null,
  icon             text,
  position         double precision not null default 0,
  created_by_type  public.engine_actor_type not null default 'user',
  created_by_id    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, slug)
);
create index engine_bases_org_idx on public.engine_bases (organization_id, position);
create trigger engine_bases_set_updated_at
  before update on public.engine_bases
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- engine_tables.base_id — which base (if any) a table belongs to.
-- ---------------------------------------------------------------------------
alter table public.engine_tables
  add column base_id uuid references public.engine_bases(id) on delete set null;
create index engine_tables_base_idx on public.engine_tables (base_id);

-- ---------------------------------------------------------------------------
-- Row-Level Security — org-scoped, same as engine_tables in 0009.
-- ---------------------------------------------------------------------------
alter table public.engine_bases enable row level security;

create policy engine_bases_rw on public.engine_bases
  for all using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
