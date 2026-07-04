# Winback playbook

Standard operating procedure for running a winback campaign against an at-risk or
churned customer segment.

## When to run this

Trigger a winback campaign when a client's `client_customer_metrics.lifecycle_stage`
shows a meaningful `at_risk` or `churned` cohort — typically recency > 60 days for a
DTC/subscription client, adjusted for the client's normal purchase cadence.

## Steps

1. **Build the audience.** Create an `audience` scoped to the client with a definition
   targeting `segment: 'at_risk'` (or `'churned'`) and a `min_monetary` floor so the
   campaign spends its discount budget on customers worth winning back.
2. **Pick or write a template.** Use the agency-wide "Winback — We miss you" email
   template (or the SMS nudge variant) unless the client has a brand-specific one.
   Personalize with `{{first_name}}` at minimum; add last-order product details when
   the data is available.
3. **Draft the campaign.** Create a `campaign` with `goal: 'winback'`, `channel` set to
   whichever channel the audience prefers, and status `draft`.
4. **Review.** Move the campaign to `in_review` and have a human confirm the copy
   matches brand voice (see `context/brand-voice/`) before it goes out.
5. **Approve and schedule.** Once approved, move to `scheduled`, then `sent` once the
   provider confirms delivery.
6. **Log the result.** Record an `activity` on the client summarizing the send (recipient
   count, channel, discount offered) so it shows up in the client's unified timeline.

## Guardrails

- Never re-target a customer who unsubscribed or revoked consent
  (`email_consent` / `sms_consent` false) — the audience query must respect these flags.
- Cap discount depth per the client's contract terms; check with the account owner if
  the SOP's default discount would exceed it.
- Don't run more than one winback send to the same customer within 30 days.
