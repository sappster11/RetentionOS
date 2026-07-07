-- 0014 — Native automations (docs/11): runtime-defined trigger → condition → actions
-- rows, plus a transactional-outbox run log. Nothing about an automation is code:
-- humans (UI), agents (MCP), and n8n (REST) all create them as data.

create table public.engine_automations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  table_id         uuid references public.engine_tables(id) on delete cascade,  -- null for org-wide schedule triggers
  name             text not null,
  enabled          boolean not null default true,
  trigger          jsonb not null,      -- {type: record.created|record.updated|field.transition|schedule, ...}
  condition        jsonb not null default '[]'::jsonb,   -- AND-ed view-filter conditions on the trigger record
  actions          jsonb not null,      -- ordered [{type: webhook|create_record|update_record, ...}]
  allow_chained    boolean not null default false,       -- may fire from automation-actor writes (depth-capped)
  last_fired_at    timestamptz,                          -- schedule-trigger watermark
  position         int not null default 0,
  created_by_type  public.engine_actor_type not null default 'user',
  created_by_id    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index engine_automations_org_idx   on public.engine_automations (organization_id);
create index engine_automations_table_idx on public.engine_automations (table_id) where table_id is not null;

create table public.engine_automation_runs (
  id               uuid primary key default gen_random_uuid(),
  automation_id    uuid not null references public.engine_automations(id) on delete cascade,
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  trigger_event    jsonb not null,      -- {type, tableId, recordId, diff?, actor, chainDepth}
  status           text not null default 'queued',   -- queued | running | succeeded | failed | dead
  attempts         int not null default 0,
  next_attempt_at  timestamptz not null default now(),
  last_error       text,
  created_at       timestamptz not null default now(),
  finished_at      timestamptz
);
create index engine_automation_runs_claim_idx
  on public.engine_automation_runs (status, next_attempt_at) where status = 'queued';
create index engine_automation_runs_automation_idx
  on public.engine_automation_runs (automation_id, created_at desc);

alter table public.engine_automations enable row level security;
alter table public.engine_automation_runs enable row level security;

create policy engine_automations_member on public.engine_automations
  for all using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy engine_automation_runs_member on public.engine_automation_runs
  for select using (public.is_org_member(organization_id));

create trigger engine_automations_set_updated_at
  before update on public.engine_automations for each row execute function public.set_updated_at();
