# 11 — Native Automations (specification)

**Status: authoritative design, not yet built.** Next major platform capability after the
in-app agent (docs/08 "Later" order). Written 2026-07-06.

## Why now

Three concrete consumers already exist:
1. The **integrity rules** doc 10 mandates ("Status→Churned end-dates open assignments
   and engagements") currently live nowhere.
2. The **prompt-doc questionnaire cycle** needs "on the 1st of the month, for each client
   where Answer Prompts is true, do X" — today that's an n8n cron with hand-built queries.
3. The reference Airtable's approval machinery is trigger-shaped ("when a thread is
   ready → post to Slack → log").

Design principle unchanged: **agent-parity.** Automations are runtime data (created by
humans in the UI, by agents via MCP, or by n8n via REST), never code deployments.

## Model

An automation = **trigger → condition → actions**, org-scoped, attached to a table.

```
engine_automations
  id, organization_id, table_id, name, enabled,
  trigger jsonb, condition jsonb, actions jsonb, position, created_by_*, timestamps

engine_automation_runs        -- the log; also the retry/dead-letter queue
  id, automation_id, org, trigger_event jsonb, status queued|running|succeeded|failed|dead,
  attempts, last_error, created_at, finished_at
```

### Triggers (v1)
- `record.created`
- `record.updated` — optional `fieldIds` filter (only these fields changing counts)
- `field.transition` — a single_select field moving to (optionally from) a specific
  choice: the "stage change" trigger. Derivable from the revision diff.
- `schedule` — cron-ish (`monthly:1`, `daily`) + a saved query over the table
  (reuses the view-filter grammar incl. relative-date ops); fires per matching record.

### Condition (v1)
Optional filter conditions on the triggering record (view-filter grammar, AND-ed).

### Actions (v1, executed in order)
- `webhook` — POST the event + record payload to a URL (the n8n escape hatch; secret
  header optional). This alone unlocks approvals + questionnaire flows externally.
- `create_record` — in any table; values may reference trigger-record fields via
  `{fld:ID}` tokens (reuse the formula tokenizer for substitution).
- `update_record` — the triggering record or a linked record (same token semantics).
- **Later:** `run_agent` — a prompt executed with engine tool access (the in-app agent
  loop headless); this is where "when a lead goes to Audit, draft the audit doc" lives.

## Delivery semantics

- **Transactional outbox:** the revision-writing transaction also inserts matching
  `engine_automation_runs` rows (status `queued`). No event bus, no missed events.
- **Dispatcher:** a drain endpoint (`POST /api/automations/drain`, secret-gated) that
  Vercel Cron hits every minute, plus an opportunistic in-process drain after mutations
  (bounded, non-blocking). Serverless-friendly; no long-lived worker.
- **At-least-once**, per-run retries with backoff (attempts ≤ 5 → `dead`), run log
  visible in the UI. Webhook receivers must tolerate duplicates.
- **Loop protection:** runs whose trigger actor is an automation are suppressed
  (depth 1) unless the automation opts in (`allowChained: true`), and chained depth
  is hard-capped at 3.
- **Schedule triggers** are materialized by the same cron drain (last-fired watermark
  on the automation row).

## Surfaces

- UI: an **Automations** panel per base (list + enable toggle + run log with per-run
  status/error; builder form for trigger/condition/actions).
- REST: `/api/v1/automations` CRUD + runs listing.
- MCP: `list_automations`, `create_automation`, `set_automation_enabled`, `list_runs` —
  so the agent can *install* automations conversationally.

## First shipped automations (seeded, disabled-off by default where risky)

1. Clients: `field.transition` Status→Churned → `update_record` linked open Assignments
   + Engagements End = today (the doc-10 integrity rule).
2. Leads: `field.transition` Stage→Closed (Won) → `webhook` (n8n; later swapped for a
   native `convert_lead` action once actions can call engine functions).
3. Prompt-doc cycle: `schedule monthly:1` over Clients where Answer Prompts eq true →
   `webhook` to the n8n questionnaire flow (payload carries the client record).

## Out of scope v1

`run_agent` action (needs cost/permission guardrails), per-automation credentials
vault, cross-org anything, UI for editing the raw jsonb.

## Open questions (for Jacob — folds into the monthly-delivery-loop discovery)

- Approval machinery: is the v1 wedge just webhook-to-n8n (Slack posting stays in n8n),
  or should posting-to-Slack become a native action early?
- Questionnaire cadence: strictly monthly-on-the-1st, or per-client cadence?
