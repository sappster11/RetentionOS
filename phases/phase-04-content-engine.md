# Phase 4 — Content Engine (email + SMS at volume)

**Goal:** produce **large volumes of data-backed** emails and SMS, grounded in each client's data and
brand voice, with human review before anything goes out. RetentionOS owns the **content and the
data**; delivery happens through the agency's Resend (our own mail), the **client's own ESP** for
their campaigns, or Twilio for SMS.

**Why now:** this is the most revenue-visible capability of a retention agency. It sits directly on
Phase 3 — the Shopify/Klaviyo analytics are what make the copy *data-backed* instead of generic.

**Prerequisites:** Phase 1 (CRM + RAG) and **Phase 3 (Client Data & Retention Analytics)** complete.
Phase 2 (PM) recommended so approved campaigns can spawn review tasks.

**Audience selection:** campaign audiences come from Phase 3 analytics — `client_segments` and
`client_customer_metrics` (RFM / lifecycle / churn_risk). "Win back at-risk high-value customers" is a
query against that data, not a guess. `mcp-content` should call `mcp-analytics` to resolve audiences.

**Read first:** [docs/04-ai-and-agent-layer.md](../docs/04-ai-and-agent-layer.md) (generation + brand
voice via RAG), [docs/03-data-model.md](../docs/03-data-model.md).

---

## Tasks

### 4.1 — Content schema
- [ ] Migration: `campaigns`, `campaign_variants`, `messages`, `templates`, `audiences` — each with
      `organization_id`, `updated_at` triggers, **RLS in the same migration**.
- [ ] `campaigns`: `client_id`, `name`, `channel` {email, sms}, `goal` {winback, onboarding,
      retention, reengagement, announcement}, `status` {draft, in_review, approved, scheduled, sent,
      archived}, `audience_id`, `created_by_type`, `metadata`.
- [ ] `campaign_variants`: `campaign_id`, `label` (A/B), `subject`, `body`, `personalization_spec
      jsonb`, `model_used`, `status`.
- [ ] `messages`: individual sends — `campaign_id` (nullable), `client_id`, `contact_id`, `channel`,
      `to`, `rendered_subject`, `rendered_body`, `provider` {resend, twilio, client_esp}, `provider_ref`,
      `status` {queued, sent, delivered, failed, bounced}, `sent_at`.
- [ ] `templates`: reusable scaffolds — `client_id` (nullable for agency-wide), `channel`, `name`,
      `body`, `variables jsonb`.
- [ ] `audiences`: `client_id`, `name`, `definition jsonb` (filter/query describing the recipient
      set), `source` {internal, client_esp}.
- [ ] Regenerate `packages/db` types.
- **Acceptance:** migrations apply to a fresh DB; RLS isolation holds; a draft campaign with a variant
      round-trips.

### 4.2 — Brand voice as context (P8)
- [ ] Per-client brand voice + guardrails stored as **markdown** in the `context/` vault (Obsidian),
      ingested into `embeddings` scoped to that client.
- [ ] Generation for a client retrieves its brand-voice context and injects it into the prompt.
- **Acceptance:** two clients with different voice docs produce recognizably different copy from the
      same brief.

### 4.3 — `mcp-content` server
- [ ] Tools: `draft_campaign` (channel + goal + client + audience → variants), `draft_sms`,
      `personalize` (render a variant for a specific contact using their data), `list_templates`,
      `create_template`, `queue_send`.
- [ ] `draft_*` use `packages/ai` `generate` with `task: 'draft_email' | 'draft_sms'` and brand-voice
      RAG context; output is **schema-validated** (subject/body/variables).
- [ ] Tenant-safe; drafting writes a `campaigns`/`campaign_variants` row; `queue_send` never fires
      without an `approved` campaign status.
- [ ] Resources: `campaign://{id}`, `template://{id}`.
- **Acceptance:** from Claude *and* an OpenAI agent, `draft_campaign` produces grounded variants saved
      as a draft; `queue_send` refuses unless approved.

### 4.4 — Delivery integrations (edges)
- [ ] **Resend** adapter for the agency's own email.
- [ ] **Twilio** adapter for SMS.
- [ ] **Client ESP** connector interface (start with one real client's platform, e.g. Klaviyo) that
      pushes approved copy/audience into the client's system rather than sending ourselves.
- [ ] Every send writes a `messages` row and an `activities` row; delivery webhooks update
      `messages.status`.
- **Acceptance:** an approved email sends via Resend and an SMS via Twilio in a test; a client-ESP
      push lands in that platform; statuses update from webhooks.

### 4.5 — Human-in-the-loop review UI
- [ ] Campaign review screen: see variants, edit copy, see the personalization spec and a sample
      rendered message, view which data grounded it, approve/reject.
- [ ] Approval transitions status → `approved`; only then can it be scheduled/sent.
- [ ] Volume workflow: generate many personalized variants across an audience, spot-check a sample,
      approve the batch.
- **Acceptance:** you can generate a personalized win-back set for an audience, review a sample,
      approve, and send — with every send logged.

### 4.6 — Guardrails
- [ ] Generated client-facing copy must be grounded (traceable to real client data / brand doc); if
      retrieval is empty, the tool declines rather than inventing facts.
- [ ] Unsubscribe/compliance handled by the delivery platform (Resend/client ESP/Twilio) — we respect
      their suppression, never bypass it.
- **Acceptance:** a client with no data produces a "not enough context" result, not fabricated copy;
      suppressed contacts are never queued.

---

## Phase 4 exit criteria (milestone demo)
For a chosen client + audience:
1. Generate a personalized **email + SMS** variant set, grounded in the client's data and brand voice.
2. Review a sample, edit, and approve.
3. Send through the real providers (Resend / Twilio / client ESP) with every send logged to
   `messages` and the client timeline.

When all three work, Phase 4 is done.

## Notes / decisions log
> Record which client ESP you integrated first, personalization approach, and any schema tweaks.
