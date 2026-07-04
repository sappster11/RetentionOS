# Phase 3 — Client Data & Retention Analytics (Shopify + Klaviyo)

**Goal:** ingest each client's **Shopify** (e-commerce) and **Klaviyo** (engagement) data into our
owned Postgres, and derive a **retention analytics model** (RFM, lifecycle stage, churn risk,
cohorts) on top. This is the analytical engine of the agency — it's what makes campaigns
*data-backed* instead of guesswork, and it feeds both the Content Engine (Phase 4) and Reporting
(Phase 5).

**Why here:** content decisions ("who to win back, with what angle, when") depend on this data
existing. It must come **before** the content engine.

**Prerequisites:** Phase 1 (CRM — clients + `channels`/`integrations`) complete. Phase 2 optional.

**Read first:** [docs/03-data-model.md](../docs/03-data-model.md#client-commerce--engagement-data-phase-3--shopify--klaviyo),
[docs/01-architecture.md](../docs/01-architecture.md) (integration plane — inbound sync, DB
canonical).

**Principles in force:** P1 (rent the edges — Shopify/Klaviyo are edges), P2 (mirror **inbound**;
our DB is canonical — never write back to their platforms).

---

## Tasks

### 3.1 — Client data schema
- [ ] Migration creating `client_customers`, `client_orders`, `client_order_items`, `client_products`,
      `client_engagement_events`, `client_segments`, `client_segment_members` per the data-model doc —
      each with `organization_id` + `client_id`, stable `(client_id, source, external_id)` uniqueness,
      `metadata jsonb` for raw payloads, and **RLS in the same migration**.
- [ ] Regenerate `packages/db` types.
- **Acceptance:** migrations apply to a fresh DB; RLS proves org+client isolation; a customer/order
      round-trips with its `external_id`.

### 3.2 — Integration connectors (`packages/integrations`)
- [ ] **Shopify** connector: OAuth/private-app auth per client; pull customers, orders, line items,
      products. Store credentials via the `integrations` table + Supabase Vault (never plaintext).
- [ ] **Klaviyo** connector: API-key auth per client; pull profiles, metrics/events, segments/lists,
      consent status.
- [ ] Each connector exposes a uniform `syncClient(clientId)` interface behind an adapter so a failing
      or swapped vendor is contained.
- **Acceptance:** for a test client with real (or sandbox) Shopify + Klaviyo creds, a manual sync
      populates the raw tables; credentials are stored encrypted, not in plain columns.

### 3.3 — Incremental sync engine
- [ ] Cursor/`updated_at`-based incremental sync (not full re-pull each run); idempotent upserts keyed
      on `(client_id, source, external_id)`.
- [ ] Scheduled sync per connected client + a manual "sync now" trigger; webhooks where the platform
      supports them (Shopify order/customer webhooks) for near-real-time.
- [ ] Sync status + last cursor tracked on `integrations`; failures surface in the UI, don't crash the
      run, and are retryable.
- **Acceptance:** a second sync only fetches changed records; re-running never duplicates; a webhook
      order appears without a full sync.

### 3.4 — Retention analytics (derived layer)
- [ ] Migration: `client_customer_metrics` (RFM + lifecycle + churn_risk + AOV/LTV) and
      `client_cohorts`, RLS-scoped.
- [ ] Computation jobs: RFM scoring (recency/frequency/monetary → 1–5), lifecycle staging
      (new/active/at_risk/churned/won_back/vip), a first-pass churn-risk heuristic, AOV, and cohort
      retention by acquisition month. Document each formula in the notes log.
- [ ] Recompute on a schedule after each sync; store `computed_at`.
- **Acceptance:** for a real client's data, RFM scores and lifecycle stages are populated and sensible
      (e.g. someone who hasn't ordered in a year is `at_risk`/`churned`); cohort retention numbers tie
      out against a manual spot-check.

### 3.5 — Analytics UI (on the client page)
- [ ] A "Retention" section on the client detail page: customer count by lifecycle stage, RFM
      distribution, cohort retention curve, at-risk/VIP segment sizes, top products.
- [ ] Drill-down to the customer list for a segment (feeds audience selection in Phase 4).
- **Acceptance:** opening a client shows a real retention snapshot derived from their Shopify/Klaviyo
      data.

### 3.6 — `mcp-analytics` server
- [ ] Read tools: `client_retention_overview`, `list_segment` (e.g. `at_risk`, `vip`, `one_time_buyers`),
      `customer_metrics` (RFM/lifecycle for a customer or cohort), `product_performance`,
      `cohort_retention`.
- [ ] Tenant-safe, read-only; results structured so an agent can reason over them.
- [ ] Resources: `retention://{clientId}`.
- **Acceptance:** from Claude *and* an OpenAI agent, "who are Client X's at-risk high-value customers,
      and what did they last buy" returns a grounded, correct answer from the analytics tables — the
      exact input the content engine needs.

---

## Phase 3 exit criteria (milestone demo)
For a real client:
1. Their Shopify + Klaviyo data is synced into RetentionOS and stays current incrementally.
2. The client page shows a real retention analytics snapshot (RFM, lifecycle, cohorts).
3. An agent can answer "who should we win back this month and what should we say to them" grounded in
   that data — teeing up the Content Engine.

When all three work, Phase 3 is done → the Content Engine (Phase 4) now has real data to write from.

## Notes / decisions log
> Record: exact RFM thresholds, lifecycle-stage rules, churn-risk heuristic, sync cadences, and which
> Shopify/Klaviyo API versions you pinned.
