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

## Tables added by later phases (forward map — do not build yet)

- **Phase 2 (PM):** `projects`, `tasks`, `task_dependencies`, `task_comments`.
- **Phase 3 (Content):** `campaigns`, `campaign_variants`, `messages` (individual email/SMS sends),
  `templates`, `audiences`.
- **Phase 4 (Reporting):** `metrics` (time-series facts), `metric_snapshots`, plus SQL views for
  dashboards. Health-score computation reads from here.
- **Phase 5 (Backbone):** no big new tables — mostly richer ingestion into `documents`/`embeddings`
  and a `conversations`/`messages_ai` pair for the chat surface.

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
