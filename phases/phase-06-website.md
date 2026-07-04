# Phase 6 — Website

**Goal:** the public storefront for the agency — explain what we do, and convert visitors into booked
calls. Deliberately last: the internal machine is the moat, and the pitch is far stronger once we can
point at a working AI-native system and real outcomes.

**Prerequisites:** none technical, but ideally at least one client result to show. Reuses the stack
from [docs/02-tech-stack.md](../docs/02-tech-stack.md). See also
[docs/06-website.md](../docs/06-website.md).

**Decision to make at the top of this phase:** new `apps/site` in this monorepo, **or** fold the
agency site into the existing `jacob-sappington-portfolio` repo. Default: new `apps/site` for a clean
brand separation; revisit if you'd rather unify personal + agency brand.

---

## Tasks

### 6.1 — Site skeleton
- [ ] Scaffold `apps/site` (Next.js, MDX for content so copy is editable without deploys).
- [ ] Shared design tokens/components with `apps/web` where sensible.
- **Acceptance:** site builds and deploys to a URL; a placeholder home page renders fast on mobile.

### 6.2 — Core one-pager
- [ ] Sections: hero (the promise), how it works (RetentionOS advantage → client *benefits*, not
      internal jargon), proof/case studies (stub until real), who it's for / services, CTA.
- [ ] Content in MDX so it's editable and can later feed our own RAG (dogfooding).
- **Acceptance:** a sharp single page that clearly says what the agency does and for whom.

### 6.3 — Conversion path
- [ ] Embedded scheduler (Cal.com/Calendly) as the primary CTA — "book a call."
- [ ] Basic analytics on the conversion funnel.
- **Acceptance:** a visitor can book a call end-to-end; the booking is tracked.

### 6.4 — Optional differentiators (only if cheap)
- [ ] A gated "chat with our approach" demo powered by the same RAG layer — proves the pitch live.
- [ ] A lightweight prospect teardown tool as a taste of the client analysis.
- **Acceptance:** if built, the demo runs on the same `packages/ai` + RAG stack, no separate
      infrastructure.

### 6.5 — Deliberately deferred
Design polish, blog/SEO engine, multi-page marketing architecture. Ship the call-booking one-pager
first; expand only when traffic justifies it.

---

## Phase 6 exit criteria (milestone demo)
1. A live, fast, mobile-friendly site that explains the agency and its AI-native edge.
2. A working "book a call" flow with tracking.
3. (Optional) a live demo of the chat/RAG capability that backs up the pitch.

## Notes / decisions log
> Record the repo decision (apps/site vs portfolio repo), scheduler choice, and analytics setup here.
