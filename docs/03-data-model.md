# 03 · Data Model

This is the spine everything plugs into. Get the CRM core right and the rest composes. Below is the
**Phase 0–1 core**; later phases add their own tables (noted at the end) but never break these.

## Conventions

- Every table: `id uuid primary key default gen_random_uuid()`, `created_at timestamptz default now()`,
  `updated_at timestamptz default now()` (trigger-maintained).
- Every table holding client data carries **`organization_id uuid not null references organizations(id)`**
  and is protected by **RLS** scoped to the caller's organization (P5).
- Foreign keys `on delete` chosen deliberately (cascade for owned children, restrict for references).
- Soft-delete via `archived_at timestamptz` where history matters (clients, projects) rather than
  hard delete.
- Flexible/vendor-specific fields go in a `metadata jsonb default '{}'` column, so we don't migrate
  for every new attribute.

## Core tables (Phase 0–1)

### organizations
The agency itself. Modeled as a table (not hardcoded) so we can white-label / run multiple agencies
later.
```
organizations
  id, name, slug, settings jsonb, created_at, updated_at
```

### users & memberships
Team members. Supabase Auth owns credentials; we mirror a profile and link membership + role.
```
users            -- profile mirror of auth.users
  id (= auth uid), email, full_name, avatar_url, created_at, updated_at

memberships      -- which users belong to which org, and their role
  id, organization_id, user_id, role, created_at
  role ∈ {owner, admin, member, viewer}
  unique(organization_id, user_id)
```

### clients
The heart of the CRM — the "accounts" currently living in Airtable.
```
clients
  id, organization_id,
  name, slug, status, lifecycle_stage,
  tier,                    -- e.g. standard | premium | enterprise
  health_score int,        -- 0..100, later computed from metrics
  owner_id uuid → users,   -- account manager
  website, industry,
  contract_start date, contract_end date, mrr numeric,
  metadata jsonb,
  archived_at, created_at, updated_at
  status ∈ {prospect, onboarding, active, at_risk, churned, paused}
  lifecycle_stage ∈ {lead, trial, active, renewal, offboarding}
```

### contacts
People at a client.
```
contacts
  id, organization_id, client_id → clients,
  full_name, email, phone, title, role_type,
  is_primary bool, timezone, metadata jsonb,
  created_at, updated_at
```

### channels
The external "containers" you currently track in Airtable: linked Slack channels, Google Drive
folders, calendars, Notion pages, etc. This is how the CRM knows *where a client's stuff lives*.
```
channels
  id, organization_id, client_id → clients,
  kind,                    -- slack | gdrive | gcal | notion | airtable | website | other
  name, external_id, url, metadata jsonb,
  last_synced_at, created_at, updated_at
  kind ∈ {slack, gdrive, gcal, notion, airtable, website, other}
```

### documents
Unstructured content we want to store and/or make chattable: briefs, notes, transcripts, ingested
markdown from the Obsidian vault, synced files. This table also anchors RAG.
```
documents
  id, organization_id, client_id → clients (nullable — some docs are agency-wide),
  title, source, source_ref,   -- source: upload | obsidian | slack | gdrive | generated
  storage_path,                -- Supabase Storage path if a file
  content text,                -- extracted/plain text for search + RAG
  metadata jsonb,
  created_at, updated_at
```

### embeddings (pgvector)
Chunk-level embeddings for RAG. Kept in a dedicated table so any content type can be embedded and
we can re-chunk without touching source rows.
```
embeddings
  id, organization_id,
  source_type,             -- document | note | client | message | ...
  source_id uuid,          -- points at the row it was derived from
  chunk_index int,
  content text,            -- the chunk's text
  embedding vector(1536),  -- dimension per chosen embedding model; keep configurable
  metadata jsonb,
  created_at
  index: ivfflat / hnsw on embedding
```

### activities
A unified timeline: notes, status changes, emails sent, meetings, agent actions. This is the
"what's happened with this client" feed and a key input to health scoring and RAG.
```
activities
  id, organization_id, client_id → clients (nullable),
  actor_type,              -- user | agent | system
  actor_id uuid,
  verb,                    -- note.created | client.status_changed | email.sent | task.completed ...
  summary text,
  data jsonb,              -- structured payload for the event
  occurred_at timestamptz, created_at
```

### integrations
Per-connector auth/config (tokens encrypted at rest / stored in Supabase Vault, **never** in plain
columns).
```
integrations
  id, organization_id,
  provider,                -- slack | google | resend | customerio | twilio | ...
  status,                  -- connected | error | disconnected
  config jsonb,            -- non-secret config
  secret_ref,              -- pointer to Supabase Vault / secret store
  connected_by uuid → users, last_synced_at,
  created_at, updated_at
```

## Client commerce & engagement data (Phase 3 — Shopify + Klaviyo)

This is the substrate for **data-backed campaigns** — the actual analytical work of a retention
agency. We mirror each client's e-commerce (Shopify) and engagement (Klaviyo) data **inbound** into
our owned Postgres (P2: DB canonical), then derive a retention analytics model on top. Content
(Phase 4) and Reporting (Phase 5) both read from these.

**Design notes:**
- All of these carry `organization_id` **and** `client_id` (the data belongs to a specific client
  account) and are RLS-scoped.
- Store a stable `external_id` + `source` on every row so sync is idempotent and traceable.
- Sync is **inbound-only and incremental** (cursor/updated-at based); we never write back to Shopify
  or Klaviyo from these tables. Raw payloads kept in `metadata jsonb` so we can re-derive later.

```
client_customers        -- unified end-customer (a client's shopper/subscriber)
  id, organization_id, client_id, source, external_id,
  email, phone, first_name, last_name,
  first_order_at, last_order_at, orders_count int, total_spent numeric,
  klaviyo_profile_id, email_consent, sms_consent,
  metadata jsonb, created_at, updated_at
  unique(client_id, source, external_id)

client_orders           -- Shopify orders
  id, organization_id, client_id, customer_id → client_customers,
  source, external_id, order_number, total numeric, currency,
  financial_status, fulfillment_status, ordered_at,
  metadata jsonb, created_at, updated_at

client_order_items      -- line items (for product/category affinity)
  id, organization_id, client_id, order_id → client_orders,
  product_external_id, product_title, variant_title,
  quantity int, price numeric, metadata jsonb

client_products         -- Shopify catalog snapshot
  id, organization_id, client_id, source, external_id,
  title, product_type, vendor, price numeric, status,
  metadata jsonb, created_at, updated_at

client_engagement_events -- Klaviyo events (opened, clicked, placed order, etc.)
  id, organization_id, client_id, customer_id → client_customers,
  source, external_id, event_type, occurred_at,
  campaign_ref, flow_ref, value numeric, metadata jsonb

client_segments          -- Klaviyo/derived segments & lists
  id, organization_id, client_id, source, external_id,
  name, kind, member_count int, definition jsonb, last_synced_at

client_segment_members   -- membership (for targeting)
  id, organization_id, client_id, segment_id → client_segments,
  customer_id → client_customers, added_at
```

### Derived retention analytics (computed, refreshed on a schedule)
The decisions layer. Computed from the raw tables above; materialized so campaigns and dashboards
read fast.
```
client_customer_metrics  -- per-customer RFM + lifecycle (one row per customer, recomputed)
  id, organization_id, client_id, customer_id → client_customers,
  recency_days int, frequency int, monetary numeric,
  rfm_recency int, rfm_frequency int, rfm_monetary int,   -- 1..5 scores
  aov numeric, predicted_ltv numeric,
  lifecycle_stage,        -- new | active | at_risk | churned | won_back | vip
  churn_risk numeric,     -- 0..1
  next_order_estimate date, computed_at

client_cohorts           -- cohort retention (by acquisition month, etc.)
  id, organization_id, client_id, cohort_key, period_index int,
  customers int, retained int, revenue numeric, computed_at
```
`lifecycle_stage` here powers "who to target" for winback/reengagement campaigns; `rfm_*` and
`churn_risk` are the signals the content engine uses to pick audiences and angle.

## Tables added by later phases (forward map — do not build yet)

- **Phase 2 (PM):** `projects`, `tasks`, `task_dependencies`, `task_comments`.
- **Phase 3 (Client Data):** the commerce/engagement + analytics tables above.
- **Phase 4 (Content):** `campaigns`, `campaign_variants`, `messages` (individual email/SMS sends),
  `templates`, `audiences`. Audiences reference `client_segments` / `client_customer_metrics`.
- **Phase 5 (Reporting):** `metrics` (time-series facts), `metric_snapshots`, plus SQL views for
  dashboards. Health-score computation reads from the analytics tables + these.
- **Phase 6 (Backbone):** no big new tables — mostly richer ingestion into `documents`/`embeddings`
  and a `conversations`/`conversation_messages` pair for the chat surface.

## RLS in one sentence

Every client-data table gets a policy: *a row is visible/editable only if the caller has a
membership in that row's `organization_id`.* Write these policies in the same migration that creates
the table — never "later."

## Entity relationship (text)

```
organization 1─┬─* memberships *─1 user
               ├─* clients ─┬─* contacts
               │            ├─* channels
               │            ├─* documents ─* embeddings
               │            └─* activities
               └─* integrations
```
