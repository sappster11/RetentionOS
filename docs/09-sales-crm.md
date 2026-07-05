# 09 — Roam Sales CRM (specification)

**Status: authoritative spec** for the first real product configured *on* the engine
(per [08-course-correction.md](08-course-correction.md), Phase D pulls the client hub;
the Sales CRM lands first because Roam has leads before it has clients).

Design inputs: a discovery session with Jacob (2026-07-04/05) plus a quantitative
analysis of his reference Airtable SalesCRM — 716 leads (2024–2026), 260 archived
(2023), 58 audit-request records, ~30 service agreements. Key findings that shaped
this spec: ~19 leads/month with <5 live leads per stage across 9 active stages
(pipeline too granular); manual stage timestamps decay from 81% fill to 5% down-funnel;
Expected Deal Size filled on 1% of records while real economics live on the agreement
records; Closed Lost Reason captured on 1 of 95 losses; 9 doc-URL fields at 0% fill.

**Product bar (Jacob's words): "a really strong CRM that mirrors what I could get out
of Salesforce but natively built into our tools."** All five Salesforce muscles are in
scope — ordered: (1) pipeline + follow-up discipline, (2) activity timeline,
(3) one-click lead→client conversion, (4) confidence-weighted forecasting,
(5) reporting dashboards.

## Tables (all created at runtime through @retentionos/engine — no migrations)

### 1. Leads
| Field | Type | Notes |
|---|---|---|
| Company | text | primary |
| Domain | url | |
| Stage | single_select | **6 stages** (below), required in practice |
| On Hold | checkbox | replaces the two "(On Hold)" stages (6 records ever used them) |
| Source | single_select | keep reference taxonomy verbatim (Twitter 24%, referrals ~19%, etc.); required at intake |
| Interested Services | multi_select | Paid Social / Email·SMS / Landing Pages / Direct Mail / Retention / Other |
| Company Type | single_select | Brand / SaaS·Tech / Agency·Consultant / Other |
| Annual Revenue | single_select | keep reference bands |
| Meta Spend | single_select | keep reference bands |
| Qualified | single_select | Qualified / Unqualified |
| What are you looking for? | long_text | intake verbatim |
| Expected Close | date | forecasting |
| Confidence | **percent** | forecasting (engine addition) |
| Est. Monthly Value | currency | forecast estimate only — signed economics live on Agreement |
| Weighted Value | **formula** | Est. Monthly Value × Confidence (engine addition) |
| Next Action | text | follow-up discipline |
| Next Action Due | date | drives Overdue/Today view |
| Lost Reason | single_select | reference taxonomy; **required-at-close is a UI/agent rule** (engine has no conditional-required yet — enforce in the close flow, later an automation) |
| Contacts | linked_record → Contacts | |
| Activities | linked_record → Activities | |
| Audit Handoff | linked_record → Audit Handoffs | |
| Agreement | linked_record → Agreements | |
| Lead # | autonumber | |
| Came In | created_time | replaces the manual "New Lead Timestamp" |

**Stages (single_select):** `New` → `Contacted` → `Discovery` → `Audit` →
`Agreement` → terminal `Closed (Won)` / `Closed (Lost)` / `Passed`.
Pre/Post-Audit variants merge into `Audit`. Stage-change history comes free from
engine revisions (no timestamp columns, ever).

### 2. Contacts
First Name (text), Last Name (text), Email (email), Job Title (text), Notes
(long_text), Leads (auto-inverse link). Separate table so contacts survive
lead→client conversion (Phase D links Clients here too).

### 3. Activities
Type (single_select: Call / Email / Meeting / Note), Date (date), Summary (text),
Detail (long_text), Lead (auto-inverse link). Rendered as the timeline in the lead's
record detail panel (newest first). Manual logging in V1; auto-capture is a
far-future integration.

### 4. Audit Handoffs *(from the reference "Audit Request Form" — 90% linked, 74–95% fill)*
Brand Name (text), Auditing Services (multi_select: Paid Social / Retention),
Platforms Needed (multi_select: Klaviyo / Shopify / Meta / GA / Attentive / Postscript /
Motion / Northbeam / Post Pilot / Triple Whale / Other), Other Access Needed (text),
Priority (single_select: 1–3), Preferred Call Timing (text), Call Notes (long_text),
Billing Notes (long_text), Lead (auto-inverse link).

### 5. Agreements *(from the reference "Service Agreement Request" — where real economics live)*
Start Date (date), Signee Name (text), Signee Email (email), Invoice Email (email),
Minimum Term **(number, months — always months; the reference data mixed units and
corrupted a currency field, so the seeder adds field descriptions stating units)**,
Services (multi_select), Creative Included (checkbox), Paid Contract Type
(single_select: Flat fee / % of ad spend), Paid Fee Base (currency), Paid Social
Monthly Cap (currency), Email Contract Type (single_select: Flat fee / Tiered),
Email Fee (currency), Tiered Pricing Notes (long_text), Call Notes (long_text),
Lead (auto-inverse link).

## Views (seeded)
- **Leads · Pipeline** — kanban grouped by Stage.
- **Leads · All Leads** — grid, sorted Came In desc.
- **Leads · Follow-ups** — grid filtered: Stage not terminal, Next Action Due ≤ today,
  sorted by due date. (If the filter grammar lacks relative dates, seed the view and
  note the gap — relative-date filters become an engine fast-follow.)
- **Leads · Won / Lost review** — grid filtered to terminal stages.
- Grid views for Contacts, Activities, Audit Handoffs, Agreements.

## Deliberate cuts (data-justified)
Expected Deal Size as a lead field in the old sense (dead at 1% — replaced by the
forecast trio above), Closed Lost Reason as optional (dead at 1/95 — becomes
required-at-close), Metrics field (0%), all 9 doc-URL fields (0% — doc links belong
to the client hub), the second source field ("TallyForm vs Other", 20% fill —
merged into Source), the two On-Hold stages, all 9 manual timestamp fields.

## Engine work this spec pulls forward
1. **percent field type** — number variant, 0–1 stored, % rendered.
2. **formula field type, minimal v1** — arithmetic (+ − × ÷) over same-record
   number/currency/percent fields, computed at read like lookup/rollup, cycle-checked,
   read-only. No functions/strings/dates in v1.
3. Noted, not blocking: conditional-required (Lost Reason), relative-date view filters.

## Sequenced delivery
1. Seed tables + views (after Phase B review lands + engine additions) — `packages/db/scripts/seed-salescrm.ts`, idempotent, built through the service layer.
2. Lead→Client conversion — Phase D, when the client hub exists.
3. Forecast rollup surfaces (weighted pipeline by close month) and dashboards — after real data accumulates.

## Out of scope for the seed
Tally intake wiring (n8n webhook, Phase D), automations, importing the reference
base's records (Roam starts empty; the old base belongs to Jacob's current job).
