-- 0005_pm.sql
-- Phase 2 · task 2.1 — agentic project management: projects, tasks, task dependencies,
-- and task comments (docs/03-data-model.md, phases/phase-02-agentic-pm.md). RLS in the
-- same migration (P5). Reuses public.actor_type (0003) for task_comments/tasks author/
-- created-by columns since agents create and comment on tasks just like humans do.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.project_status as enum ('planned', 'active', 'on_hold', 'done', 'cancelled');
create type public.task_status    as enum ('todo', 'in_progress', 'blocked', 'review', 'done');
create type public.task_priority  as enum ('low', 'medium', 'high', 'urgent');

-- ---------------------------------------------------------------------------
-- projects — a body of work for a client (or agency-wide, when client_id is null)
-- ---------------------------------------------------------------------------
create table public.projects (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  client_id        uuid references public.clients(id) on delete cascade,
  name             text not null,
  status           public.project_status not null default 'planned',
  owner_id         uuid references public.users(id) on delete set null,
  starts_on        date,
  due_on           date,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index projects_org_idx    on public.projects (organization_id);
create index projects_client_idx on public.projects (client_id);
create trigger projects_set_updated_at
  before update on public.projects for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- tasks — the unit of work; standalone (project_id null) or under a project
-- ---------------------------------------------------------------------------
create table public.tasks (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  project_id        uuid references public.projects(id) on delete set null,
  client_id         uuid references public.clients(id) on delete cascade,
  title             text not null,
  details           text,
  status            public.task_status not null default 'todo',
  priority          public.task_priority not null default 'medium',
  assignee_id       uuid references public.users(id) on delete set null,
  due_on            date,
  completed_at      timestamptz,
  created_by_type   public.actor_type not null default 'user',
  created_by_id     uuid,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index tasks_org_status_idx on public.tasks (organization_id, status);
create index tasks_client_idx     on public.tasks (client_id);
create index tasks_project_idx    on public.tasks (project_id);
create index tasks_assignee_idx   on public.tasks (assignee_id);
create index tasks_due_on_idx     on public.tasks (due_on);
create trigger tasks_set_updated_at
  before update on public.tasks for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- task_dependencies — task_id is blocked by depends_on_task_id
-- ---------------------------------------------------------------------------
create table public.task_dependencies (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  task_id              uuid not null references public.tasks(id) on delete cascade,
  depends_on_task_id   uuid not null references public.tasks(id) on delete cascade,
  created_at           timestamptz not null default now(),
  unique (task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id)
);
create index task_dependencies_org_idx  on public.task_dependencies (organization_id);
create index task_dependencies_task_idx on public.task_dependencies (task_id);

-- ---------------------------------------------------------------------------
-- task_comments — discussion thread on a task (human or agent authored)
-- ---------------------------------------------------------------------------
create table public.task_comments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  task_id          uuid not null references public.tasks(id) on delete cascade,
  author_type      public.actor_type not null default 'user',
  author_id        uuid,
  body             text not null,
  created_at       timestamptz not null default now()
);
create index task_comments_org_idx  on public.task_comments (organization_id);
create index task_comments_task_idx on public.task_comments (task_id, created_at asc);

-- ---------------------------------------------------------------------------
-- Row-Level Security — visible/editable only within the caller's organization.
-- ---------------------------------------------------------------------------
alter table public.projects          enable row level security;
alter table public.tasks             enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.task_comments     enable row level security;

create policy projects_rw on public.projects
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy tasks_rw on public.tasks
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy task_dependencies_rw on public.task_dependencies
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy task_comments_rw on public.task_comments
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
