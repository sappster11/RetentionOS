-- 0007_reporting.sql
-- Phase 5 · task 5.1 — reporting data foundation: a generic time-series table for computed
-- metrics (client health scores, portfolio rollups, ...) so dashboards/reports can query a
-- history instead of only "current value" columns on clients/organizations. RLS in the same
-- migration (P5 convention, see 0004/0005).
--
-- Sync convention: this table is populated by the reporting recompute job (service role,
-- see packages/db/src/reporting.ts#captureSnapshots), not by client writes — mirrors
-- public.embeddings (0002_pgvector_embeddings.sql): select policy only, no insert/update/
-- delete policy for regular org members.

-- ---------------------------------------------------------------------------
-- metric_snapshots — a time series of computed metrics, per-org and optionally per-client.
-- One row per (metric_key, captured_at) observation; nothing here is upserted in place, so
-- history accumulates naturally and reports can chart it over time.
-- ---------------------------------------------------------------------------
create table public.metric_snapshots (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  client_id        uuid references public.clients(id) on delete cascade,
  metric_key       text not null,               -- e.g. health_score | customers | revenue |
                                                 -- at_risk_customers | portfolio_revenue |
                                                 -- avg_health | at_risk_clients | active_clients
  value            numeric not null,
  period           text not null default 'all', -- v1: only 'all' (a running snapshot); reserved
                                                 -- for future daily/weekly/monthly rollups
  captured_at      timestamptz not null default now(),
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index metric_snapshots_org_metric_idx on public.metric_snapshots (organization_id, metric_key);
create index metric_snapshots_client_idx     on public.metric_snapshots (client_id);

-- ---------------------------------------------------------------------------
-- Row-Level Security — readable only within the caller's organization. Populated by the
-- reporting recompute job (service role, which bypasses RLS); regular org members get
-- read-only access, mirroring public.embeddings in 0002_pgvector_embeddings.sql.
-- ---------------------------------------------------------------------------
alter table public.metric_snapshots enable row level security;

create policy metric_snapshots_select on public.metric_snapshots
  for select using (public.is_org_member(organization_id));

-- Writes are performed by the reporting recompute job (service role), which bypasses RLS.
