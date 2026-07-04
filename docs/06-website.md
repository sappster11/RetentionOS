# 06 · Website (Phase 6)

Deliberately **last**. The internal machine is the moat; the website is the storefront, and it's far
more persuasive once we can point at a working system, real client outcomes, and (optionally) a live
demo of the AI capabilities.

## Goals
- Explain what the agency does and who it's for.
- Convert visitors → booked calls (the only metric that matters at launch).
- Show, don't tell: lean on the fact that we run an AI-native stack most agencies can't.

## Approach
- Separate deployable: `apps/site` (or the existing `jacob-sappington-portfolio` repo if you'd
  rather keep the personal brand and agency brand together — decide when we get here).
- **Next.js** (same stack as the app → shared components, one thing to learn) or a simpler static
  setup if the site stays brochure-only. Default to Next.js for consistency.
- Content-managed via markdown/MDX so copy is editable without deploys, and so the same content can
  feed our own RAG (dogfooding).
- Fast, accessible, great on mobile. Booking via an embedded scheduler (Cal.com/Calendly).

## Sections (first cut)
- Hero: the promise (AI-native retention that compounds).
- How it works: the RetentionOS advantage (owned data, agentic ops, data-backed content) —
  translated into client benefits, not internal jargon.
- Proof: results/case studies (fill in as they exist).
- Services / who it's for.
- CTA: book a call.

## Optional differentiators (only if cheap to add)
- A gated "chat with our approach" demo powered by the same RAG layer — proves the pitch live.
- A short teardown/tool that gives a prospect a taste of the analysis they'd get as a client.

## Explicitly deferred
Design polish, blog/SEO engine, and multi-page marketing architecture. Ship a sharp one-pager that
books calls first; expand only when there's traffic to justify it.

> When we reach this phase, write a dedicated `phases/phase-06-website.md` spec the same way the
> other phases are specified.
