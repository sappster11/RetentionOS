-- 0010_engine_links.sql
-- Phase B · Relations & views — linked records (+ the storage the computed lookup/rollup
-- and autonumber field types need). Lookup and rollup are computed at read time and store
-- nothing; only linked records and autonumber touch the schema.
--
-- Design notes:
--   * engine_record_links is the SOURCE OF TRUTH for linked_record values. A record's
--     values jsonb does NOT store link arrays — the engine computes them from this join
--     table at read time (batched). This keeps both directions of a link consistent
--     automatically (one edge, two reads).
--   * A linked_record field auto-creates its INVERSE linked_record field on the target
--     table (like Airtable), each pointing at the other via options.inverseFieldId. The
--     two fields share the same set of edges, read from opposite ends.
--   * autonumber uses a per-table counter column on engine_tables, bumped inside the
--     record-create transaction. created_time / last_modified_time read straight off
--     engine_records.created_at / updated_at (0009 already bumps updated_at via trigger).

-- ---------------------------------------------------------------------------
-- Per-table autonumber counter. Bumped in createRecord's transaction (no gaps concern —
-- Airtable's autonumber also skips on delete). NULL-safe default 0.
-- ---------------------------------------------------------------------------
alter table public.engine_tables
  add column autonumber_seq bigint not null default 0;

-- ---------------------------------------------------------------------------
-- engine_record_links — one row per directed link edge (from_record -> to_record) under a
-- specific linked_record field. Reading the inverse field walks the same rows from the
-- other end. `position` preserves link order within a from-record (Airtable-like).
-- ---------------------------------------------------------------------------
create table public.engine_record_links (
  id               uuid primary key default gen_random_uuid(),
  field_id         uuid not null references public.engine_fields(id) on delete cascade,
  from_record_id   uuid not null references public.engine_records(id) on delete cascade,
  to_record_id     uuid not null references public.engine_records(id) on delete cascade,
  position         double precision not null default 0,
  created_at       timestamptz not null default now(),
  unique (field_id, from_record_id, to_record_id)
);
-- Both directions are hot: "links for field F from record R" (grid/detail render) and
-- "which records point AT record R through field F" (inverse field render).
create index engine_record_links_from_idx on public.engine_record_links (field_id, from_record_id, position);
create index engine_record_links_to_idx   on public.engine_record_links (field_id, to_record_id);

-- ---------------------------------------------------------------------------
-- Row-Level Security. engine_record_links has no org column; it inherits tenancy through
-- the records it joins. A link edge is only visible/writable when BOTH endpoints resolve to
-- the SAME org AND the caller is a member of that org — an edge must never straddle two
-- orgs, and neither end may belong to an org the user isn't in. Same inheritance pattern
-- 0009 uses for engine_fields / engine_views, tightened for the two-ended join.
-- ---------------------------------------------------------------------------
alter table public.engine_record_links enable row level security;

create policy engine_record_links_rw on public.engine_record_links
  for all using (
    exists (
      select 1
      from public.engine_records rf
      join public.engine_records rt on rt.id = engine_record_links.to_record_id
      where rf.id = engine_record_links.from_record_id
        and rf.organization_id = rt.organization_id
        and public.is_org_member(rf.organization_id)
    )
  )
  with check (
    exists (
      select 1
      from public.engine_records rf
      join public.engine_records rt on rt.id = engine_record_links.to_record_id
      where rf.id = engine_record_links.from_record_id
        and rf.organization_id = rt.organization_id
        and public.is_org_member(rf.organization_id)
    )
  );
