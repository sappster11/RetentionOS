-- 0008_backbone.sql
-- Phase 6 · task 6.1 — the data backbone for "chat with everything": conversations +
-- messages persisted so a chat thread survives a reload, and the keyless unified retrieval
-- spine (packages/db/src/search.ts#searchEverything) that fans out ILIKE search across the
-- CRM/PM/content tables already in place (0003-0007). RLS in the same migration (P5).
-- Reuses public.actor_type is NOT needed here — conversations/messages are user- or
-- assistant-authored chat turns, not agent activity log entries.

-- ---------------------------------------------------------------------------
-- conversations — one chat thread per user (or anonymous/service, when user_id is null)
-- ---------------------------------------------------------------------------
create table public.conversations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  user_id          uuid references public.users(id) on delete set null,
  title            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index conversations_org_idx on public.conversations (organization_id);
create trigger conversations_set_updated_at
  before update on public.conversations for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- conversation_messages — turns in a conversation; citations point back at search hits
-- (SearchHit.url values from searchEverything) so answers can be traced to their sources.
-- ---------------------------------------------------------------------------
create table public.conversation_messages (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  role             text not null check (role in ('user', 'assistant', 'system')),
  content          text not null,
  citations        jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now()
);
create index conversation_messages_conversation_idx on public.conversation_messages (conversation_id);

-- ---------------------------------------------------------------------------
-- Row-Level Security — visible/editable only within the caller's organization.
-- ---------------------------------------------------------------------------
alter table public.conversations         enable row level security;
alter table public.conversation_messages enable row level security;

create policy conversations_rw on public.conversations
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy conversation_messages_rw on public.conversation_messages
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
