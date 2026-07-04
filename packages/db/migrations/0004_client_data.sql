-- 0004_client_data.sql
-- Phase 3 · task 3.1 — client commerce & engagement data (Shopify + Klaviyo mirrors) and the
-- derived retention analytics computed on top (docs/03-data-model.md, "Client commerce &
-- engagement data" + "Derived retention analytics"). RLS in the same migration (P5).
--
-- Sync convention: every raw/synced table carries (source, external_id) and is unique on
-- (client_id, source, external_id) so inbound sync is idempotent. Raw payloads live in
-- metadata jsonb so we can re-derive later without re-syncing.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
-- NOTE: distinct from public.lifecycle_stage (CRM client lifecycle, 0003). This one describes
-- an end-customer's retention lifecycle, computed per client_customer_metrics row.
create type public.lifecycle_stage_customer as enum (
  'new', 'active', 'at_risk', 'churned', 'won_back', 'vip'
);

-- ---------------------------------------------------------------------------
-- client_customers — unified end-customer (a client's shopper/subscriber)
-- ---------------------------------------------------------------------------
create table public.client_customers (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  client_id          uuid not null references public.clients(id) on delete cascade,
  source             text not null,               -- shopify | klaviyo | manual | ...
  external_id        text not null,
  email              text,
  phone              text,
  first_name         text,
  last_name          text,
  first_order_at     timestamptz,
  last_order_at      timestamptz,
  orders_count       int not null default 0,
  total_spent        numeric(12, 2) not null default 0,
  klaviyo_profile_id text,
  email_consent      boolean,
  sms_consent        boolean,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (client_id, source, external_id)
);
create index client_customers_org_idx      on public.client_customers (organization_id);
create index client_customers_client_idx   on public.client_customers (client_id);
create index client_customers_email_idx    on public.client_customers (client_id, email);
create trigger client_customers_set_updated_at
  before update on public.client_customers for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- client_orders — Shopify orders
-- ---------------------------------------------------------------------------
create table public.client_orders (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  client_id           uuid not null references public.clients(id) on delete cascade,
  customer_id         uuid not null references public.client_customers(id) on delete cascade,
  source              text not null,
  external_id         text not null,
  order_number        text,
  total               numeric(12, 2) not null default 0,
  currency            text not null default 'USD',
  financial_status    text,
  fulfillment_status  text,
  ordered_at          timestamptz not null,
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (client_id, source, external_id)
);
create index client_orders_org_idx       on public.client_orders (organization_id);
create index client_orders_client_idx    on public.client_orders (client_id, ordered_at desc);
create index client_orders_customer_idx  on public.client_orders (customer_id, ordered_at desc);
create trigger client_orders_set_updated_at
  before update on public.client_orders for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- client_order_items — line items (for product/category affinity). Immutable once synced
-- (a Shopify line item doesn't change after the order is placed), so no updated_at trigger.
-- ---------------------------------------------------------------------------
create table public.client_order_items (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  client_id            uuid not null references public.clients(id) on delete cascade,
  order_id             uuid not null references public.client_orders(id) on delete cascade,
  product_external_id  text,
  product_title        text,
  variant_title        text,
  quantity             int not null default 1,
  price                numeric(12, 2) not null default 0,
  metadata             jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now()
);
create index client_order_items_org_idx      on public.client_order_items (organization_id);
create index client_order_items_client_idx   on public.client_order_items (client_id);
create index client_order_items_order_idx    on public.client_order_items (order_id);
create index client_order_items_product_idx  on public.client_order_items (client_id, product_external_id);

-- ---------------------------------------------------------------------------
-- client_products — Shopify catalog snapshot
-- ---------------------------------------------------------------------------
create table public.client_products (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  client_id        uuid not null references public.clients(id) on delete cascade,
  source           text not null,
  external_id      text not null,
  title            text not null,
  product_type     text,
  vendor           text,
  price            numeric(12, 2),
  status           text,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (client_id, source, external_id)
);
create index client_products_org_idx    on public.client_products (organization_id);
create index client_products_client_idx on public.client_products (client_id);
create trigger client_products_set_updated_at
  before update on public.client_products for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- client_engagement_events — Klaviyo events (opened, clicked, placed order, etc.). Immutable
-- facts (like public.activities), so occurred_at + created_at only, no updated_at.
-- ---------------------------------------------------------------------------
create table public.client_engagement_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  client_id        uuid not null references public.clients(id) on delete cascade,
  customer_id      uuid not null references public.client_customers(id) on delete cascade,
  source           text not null,
  external_id      text not null,
  event_type       text not null,               -- opened | clicked | placed_order | subscribed | ...
  occurred_at      timestamptz not null,
  campaign_ref     text,
  flow_ref         text,
  value            numeric(12, 2),
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  unique (client_id, source, external_id)
);
create index client_engagement_events_org_idx      on public.client_engagement_events (organization_id);
create index client_engagement_events_client_idx   on public.client_engagement_events (client_id, occurred_at desc);
create index client_engagement_events_customer_idx on public.client_engagement_events (customer_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- client_segments — Klaviyo/derived segments & lists
-- ---------------------------------------------------------------------------
create table public.client_segments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  client_id        uuid not null references public.clients(id) on delete cascade,
  source           text not null,
  external_id      text not null,
  name             text not null,
  kind             text,                        -- list | segment
  member_count     int not null default 0,
  definition       jsonb not null default '{}'::jsonb,
  last_synced_at   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (client_id, source, external_id)
);
create index client_segments_org_idx    on public.client_segments (organization_id);
create index client_segments_client_idx on public.client_segments (client_id);
create trigger client_segments_set_updated_at
  before update on public.client_segments for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- client_segment_members — membership (for targeting)
-- ---------------------------------------------------------------------------
create table public.client_segment_members (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  client_id        uuid not null references public.clients(id) on delete cascade,
  segment_id       uuid not null references public.client_segments(id) on delete cascade,
  customer_id      uuid not null references public.client_customers(id) on delete cascade,
  added_at         timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  unique (segment_id, customer_id)
);
create index client_segment_members_org_idx      on public.client_segment_members (organization_id);
create index client_segment_members_client_idx   on public.client_segment_members (client_id);
create index client_segment_members_customer_idx on public.client_segment_members (customer_id);
create index client_segment_members_segment_idx  on public.client_segment_members (segment_id);

-- ---------------------------------------------------------------------------
-- client_customer_metrics — per-customer RFM + lifecycle (one row per customer, recomputed on a
-- schedule by the analytics job; see packages/db/src/clientData.ts#recomputeAnalytics).
-- ---------------------------------------------------------------------------
create table public.client_customer_metrics (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  client_id             uuid not null references public.clients(id) on delete cascade,
  customer_id           uuid not null references public.client_customers(id) on delete cascade,
  recency_days          int,
  frequency             int not null default 0,
  monetary              numeric(12, 2) not null default 0,
  rfm_recency           int not null,
  rfm_frequency         int not null,
  rfm_monetary          int not null,
  aov                   numeric(12, 2),
  predicted_ltv         numeric(12, 2),
  lifecycle_stage       public.lifecycle_stage_customer not null,
  churn_risk            numeric(4, 3) not null,
  next_order_estimate   date,
  computed_at           timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  unique (client_id, customer_id)
);
create index client_customer_metrics_org_idx        on public.client_customer_metrics (organization_id);
create index client_customer_metrics_client_idx     on public.client_customer_metrics (client_id);
create index client_customer_metrics_customer_idx   on public.client_customer_metrics (customer_id);
create index client_customer_metrics_lifecycle_idx  on public.client_customer_metrics (client_id, lifecycle_stage);

-- ---------------------------------------------------------------------------
-- client_cohorts — cohort retention (by acquisition month)
-- ---------------------------------------------------------------------------
create table public.client_cohorts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  client_id        uuid not null references public.clients(id) on delete cascade,
  cohort_key       date not null,                -- acquisition month, truncated (first-of-month)
  period_index     int not null,                 -- months since cohort_key, 0..12
  customers        int not null default 0,        -- cohort size
  retained         int not null default 0,        -- how many of them ordered again in this period
  revenue          numeric(12, 2) not null default 0,
  computed_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  unique (client_id, cohort_key, period_index)
);
create index client_cohorts_org_idx    on public.client_cohorts (organization_id);
create index client_cohorts_client_idx on public.client_cohorts (client_id, cohort_key);

-- ---------------------------------------------------------------------------
-- Row-Level Security — readable only within the caller's organization. These tables are
-- populated by sync jobs / the analytics recompute job (service role, which bypasses RLS);
-- regular org members get read-only access, mirroring public.integrations in 0003_crm.sql.
-- ---------------------------------------------------------------------------
alter table public.client_customers         enable row level security;
alter table public.client_orders            enable row level security;
alter table public.client_order_items       enable row level security;
alter table public.client_products          enable row level security;
alter table public.client_engagement_events enable row level security;
alter table public.client_segments          enable row level security;
alter table public.client_segment_members   enable row level security;
alter table public.client_customer_metrics  enable row level security;
alter table public.client_cohorts           enable row level security;

create policy client_customers_select on public.client_customers
  for select using (public.is_org_member(organization_id));
create policy client_orders_select on public.client_orders
  for select using (public.is_org_member(organization_id));
create policy client_order_items_select on public.client_order_items
  for select using (public.is_org_member(organization_id));
create policy client_products_select on public.client_products
  for select using (public.is_org_member(organization_id));
create policy client_engagement_events_select on public.client_engagement_events
  for select using (public.is_org_member(organization_id));
create policy client_segments_select on public.client_segments
  for select using (public.is_org_member(organization_id));
create policy client_segment_members_select on public.client_segment_members
  for select using (public.is_org_member(organization_id));
create policy client_customer_metrics_select on public.client_customer_metrics
  for select using (public.is_org_member(organization_id));
create policy client_cohorts_select on public.client_cohorts
  for select using (public.is_org_member(organization_id));
-- Writes (sync jobs, recompute job) stay service-role only — no insert/update/delete policy for
-- regular org members.
