# Phase 4 — Reporting Dashboards

**Goal:** great reporting over our **own** data — for the team now, and client-facing later. Turn the
`health_score` placeholder into a real, computed number, and make the metrics *speakable* by agents,
not just viewable.

**Why now:** by this phase we have real data flowing (clients, activity, tasks, campaigns/sends), so
there's something worth measuring.

**Prerequisites:** Phases 1–3 (data to report on).

**Read first:** [docs/03-data-model.md](../docs/03-data-model.md),
[docs/02-tech-stack.md](../docs/02-tech-stack.md) (Metabase vs in-app).

---

## Tasks

### 4.1 — Metrics schema & views
- [ ] Migration: `metrics` (time-series facts: `organization_id`, `client_id`, `metric_key`, `value`,
      `period_start`, `period_end`, `source`, `metadata`) and `metric_snapshots` (point-in-time
      rollups) — with RLS.
- [ ] SQL **views** for common cuts: client health inputs, campaign performance, task throughput,
      activity volume.
- [ ] Regenerate `packages/db` types.
- **Acceptance:** migrations apply; a metric can be inserted and read back scoped by org/client.

### 4.2 — Metric ingestion
- [ ] Jobs that compute metrics from existing tables (activity counts, task completion rates,
      campaign send/delivery/response where available) into `metrics` on a schedule.
- [ ] Where client retention data lives in an external platform (client ESP / e-comm), pull it inbound
      via the edge connector into `metrics` (P2: our DB stays canonical).
- **Acceptance:** running the job populates `metrics` from real data; re-running is idempotent per
      period.

### 4.3 — Health score (make it real)
- [ ] Replace the Phase 1 `clients.health_score` placeholder with a computed score from defined
      inputs (e.g. recent activity, overdue tasks, campaign engagement, contract signals). Document
      the formula.
- [ ] Recompute on a schedule; write changes as `activities` (`client.health_changed`).
- **Acceptance:** health scores reflect the formula from live data; a change in inputs moves the score
      and logs an activity.

### 4.4 — Dashboards (fast path: Metabase)
- [ ] Stand up Metabase against the Postgres read replica / role with RLS-safe access.
- [ ] Build core dashboards: agency overview, per-client retention, campaign performance, team
      throughput.
- **Acceptance:** live dashboards render real numbers; access is scoped so a viewer can't see other
      orgs' data.

### 4.5 — Dashboards (in-app, client-facing)
- [ ] Embed the metrics that belong *inside* RetentionOS as in-app charts (Recharts/Tremor) on the
      client detail page — a retention snapshot the account manager (and later the client) sees.
- **Acceptance:** the client page shows an embedded, current retention dashboard.

### 4.6 — `mcp-reporting` server
- [ ] Tools: `client_health` (score + drivers), `retention_metrics` (by client/period),
      `run_report` (named report → structured result), `at_risk_clients`.
- [ ] Tenant-safe; read-only.
- [ ] Resources: `report://{name}`.
- **Acceptance:** from Claude *and* an OpenAI agent, "which clients are most at risk this month and
      why" returns an answer backed by the same `metrics` the dashboards use — numbers match.

---

## Phase 4 exit criteria (milestone demo)
1. A live retention dashboard per client (Metabase + embedded in-app).
2. Real, computed health scores that move with the data and log changes.
3. Ask an agent "which clients are most at risk and why" and get an answer whose numbers match the
   dashboards.

When all three work, Phase 4 is done.

## Notes / decisions log
> Record the health-score formula, metric definitions, and Metabase access setup here.
