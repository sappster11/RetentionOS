-- 0001_foundations.sql
-- Phase 0 · task 0.2 — organizations, users, memberships + multi-tenant RLS baseline.
-- Principle P5: RLS lives in the same migration that creates the table. No "security later."

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;      -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

-- Maintains updated_at on any table with such a column.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- organizations — the agency itself (table, not hardcoded, so we can white-label later)
-- ---------------------------------------------------------------------------
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- users — profile mirror of auth.users
-- ---------------------------------------------------------------------------
create table public.users (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- memberships — which users belong to which org, and their role
-- ---------------------------------------------------------------------------
create type public.membership_role as enum ('owner', 'admin', 'member', 'viewer');

create table public.memberships (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  user_id          uuid not null references public.users(id) on delete cascade,
  role             public.membership_role not null default 'member',
  created_at       timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index memberships_user_id_idx on public.memberships (user_id);
create index memberships_org_id_idx  on public.memberships (organization_id);

-- ---------------------------------------------------------------------------
-- Tenancy helper — is the current auth user a member of :org?
-- SECURITY DEFINER so it can read memberships regardless of the caller's own RLS,
-- while remaining safe (it only ever returns a boolean about the current user).
-- ---------------------------------------------------------------------------
create or replace function public.is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.organization_id = org
      and m.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.users         enable row level security;
alter table public.memberships   enable row level security;

-- organizations: visible only to their members.
create policy organizations_select on public.organizations
  for select using (public.is_org_member(id));

-- users: you can always see/update your own profile; and see profiles of people
-- who share at least one organization with you.
create policy users_select_self on public.users
  for select using (id = auth.uid());

create policy users_select_coworkers on public.users
  for select using (
    exists (
      select 1
      from public.memberships me
      join public.memberships them
        on them.organization_id = me.organization_id
      where me.user_id = auth.uid()
        and them.user_id = public.users.id
    )
  );

create policy users_update_self on public.users
  for update using (id = auth.uid()) with check (id = auth.uid());

-- memberships: visible to members of the same organization.
create policy memberships_select on public.memberships
  for select using (public.is_org_member(organization_id));

-- Note: inserts/updates to organizations & memberships are performed by the
-- service role (server-side onboarding flow), which bypasses RLS. Add explicit
-- write policies here if/when clients get self-serve org creation.
