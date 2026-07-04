-- LOCAL DEV ONLY — do not apply to Supabase.
-- Supabase provides the `auth` schema, `auth.users`, and `auth.uid()`. Plain Postgres
-- doesn't, so this shim recreates just enough of them for our migrations to apply and
-- for local testing. It is NOT a numbered migration, so it never runs against Supabase.

create extension if not exists pgcrypto;

create schema if not exists auth;

create table if not exists auth.users (
  id           uuid primary key default gen_random_uuid(),
  email        text,
  created_at   timestamptz not null default now()
);

-- Supabase derives auth.uid() from the request JWT. Locally we read a GUC that a
-- session can set (select set_config('request.jwt.claim.sub', '<uuid>', true)) to
-- simulate "the current user" when testing RLS as a non-superuser role.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
