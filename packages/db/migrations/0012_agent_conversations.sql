-- 0012_agent_conversations.sql
-- Conversation persistence for the IN-APP workspace agent (the chat panel). Until now the
-- client held the whole session in component state and lost it on refresh; these tables
-- make conversations durable and listable.
--
-- Design notes:
--   * These are ENGINE-NATIVE tables, not a reuse of 0008's conversations/messages —
--     those are the pre-pivot "chat with everything" backbone (parked). The agent panel
--     stores the UI-shape transcript instead: `content` is jsonb holding the panel's
--     message parts (text blocks AND tool action chips), so a reloaded conversation
--     renders exactly what was streamed.
--   * `title` is NULLABLE: a conversation is created before the first model call, and the
--     engine auto-titles it from the first user message on the first appendMessages.
--   * agent_messages carries a denormalized organization_id so RLS stays a single
--     is_org_member() check (same pattern as engine_records in 0009), and deletes cascade
--     from the conversation.
--   * Same org-scoped RLS pattern as engine_tables (0009): is_org_member() from 0001.

-- ---------------------------------------------------------------------------
-- agent_conversations — one chat-panel thread.
-- ---------------------------------------------------------------------------
create table public.agent_conversations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  title            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index agent_conversations_org_recent_idx
  on public.agent_conversations (organization_id, updated_at desc);
create trigger agent_conversations_set_updated_at
  before update on public.agent_conversations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- agent_messages — one persisted turn (user or assistant), UI-shape content.
-- ---------------------------------------------------------------------------
create table public.agent_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.agent_conversations(id) on delete cascade,
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  -- Global insertion order. created_at alone can't order a transcript: messages appended
  -- in one transaction share the same now(), and uuid tiebreaks are random.
  seq              bigint generated always as identity,
  role             text not null check (role in ('user', 'assistant')),
  -- The panel's message parts: [{kind:'text',text} | {kind:'tool',tool,summary,isError?}, ...]
  content          jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now()
);
create index agent_messages_conversation_idx
  on public.agent_messages (conversation_id, seq asc);

-- ---------------------------------------------------------------------------
-- Row-Level Security — org-scoped, same as engine_tables in 0009.
-- ---------------------------------------------------------------------------
alter table public.agent_conversations enable row level security;
alter table public.agent_messages enable row level security;

create policy agent_conversations_rw on public.agent_conversations
  for all using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy agent_messages_rw on public.agent_messages
  for all using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
