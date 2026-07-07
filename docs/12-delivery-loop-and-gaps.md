# 12 — Roam's Delivery Loop & the Differentiation Gap Map

**Status: discovery capture (2026-07-06), authoritative input for everything after the
platform.** Jacob's answer to the long-open question "walk me through a month of
retention delivery," plus the honest map of built vs not.

## The delivery loop (Jacob's words, structured)

**Onboarding arc (per new client):**
1. **Audit** their existing programs (email/SMS/lifecycle).
2. **Growth plan** built from the audit, to kick off the engagement.
3. **Kickoff + data ingestion**: meet them, dig into their data, send surveys, ingest
   the answers — "we know a lot more about them because of that."
4. **30-60-90 plan** synthesized from audit findings + kickoff call + surveys.
   ("A lot of data ingestion.")

**Ongoing loop (monthly-ish, continuous):**
5. **Campaign process**: segmentation, digging into Klaviyo results, developing the
   retention program — exporting client reviews, ingesting LTV data.
6. **List growth**: new pop-up forms and similar. "Email, SMS, and lifecycle
   performance and list growth is the main thing."
7. Constant search for retention-channel growth. Plus in-flight internal tooling:
   **brand voice centers** (how we write for each brand) and a **Figma connector**
   (comments per month per client + negative-sentiment detection on feedback).

## Gap map: built vs differentiated

**Built (the platform):** engine, Sales CRM + Client Hub as configuration, native
forms, in-app agent (OpenRouter/Anthropic), generic MCP, filtered rollups, bases.
Jacob's verdict: this layer alone ≈ what Airtable already offered him. Correct — it's
the *foundation*, not the differentiation.

**Priority correction (Jacob's original vision message, resurfaced 2026-07-06):**
*"I think honestly the copywriting and marketing part of it is honestly the most
important. It needs to host the brands, it needs to be capable of pulling in research,
it needs to be able to have skills built into it, it needs to be agentic."* — so the
copy/marketing engine (item 2 below, as **Content Studio**) is co-first with analytics
and starts immediately; the two interlock ("data-backed emails" needs the data layer).

**The differentiation backlog, priority-ordered:**

1. **Analytics backbone reconnection** (email/SMS/lifecycle first). Parked pre-pivot
   code covers most of it: Shopify+Klaviyo sync (`packages/integrations`,
   fixture-verified, live paths written), RFM/lifecycle/churn/LTV scoring + cohort
   tables (migrations 0004, compute scripts), analytics MCP. Rebuild target: a
   per-client **Retention** surface reached from the Client record (per docs/08
   decision 4), Klaviyo-first, backed by real per-client credentials stored via the
   integrations pattern.
2. **Campaign process + brand voice center.** Parked content-engine code (campaigns/
   templates/variants/audiences) is raw material. Brand voice center = per-client
   voice doc (engine table) + the agent writing *with* it. Approvals machinery
   (docs/11 automations + n8n Slack flow) closes the loop.
3. **Onboarding machinery**: audit workspace, survey ingestion (Tally → n8n →
   engine), 30-60-90 plan generation (agent synthesis over audit + survey + kickoff
   data — this is a `run_agent` automation consumer).
4. **Micro-tools**: Figma comments/sentiment connector (n8n poll → engine table →
   automation on negative sentiment), reviews export ingestion, list-growth/pop-up
   tracking (metrics per client per month).

## Sequencing rationale

1 before 2: campaigns argue from data; the data layer must exist. 2 before 3's plan
generator: the voice center and campaign history are inputs to good plans. 4 rides on
automations (docs/11) and is mostly n8n + small engine tables — cheap once 1–2 exist.

## Open questions carried forward

- Approval machinery v1: webhook-to-n8n (Slack posting stays in n8n) vs native Slack
  action (docs/11 question, still open).
- Questionnaire cadence: monthly-on-the-1st vs per-client (docs/11, still open).
- Which Klaviyo account/creds to pilot the analytics reconnection against (Roam has
  no clients yet — a demo/sandbox account, or fixtures until the first client).
