# 14 — Work Tracker & Client Portal (specification)

**Status: authoritative (2026-07-07), from Jacob's direction** ("an Asana clone where all
the work gets tracked internally, and a client dashboard where all the documents and
approvals live for the client").

## Work Tracker (internal — "Ops" base)

Engine configuration, not code (the platform IS the task tool):
- **Projects** — Name, Client (link), Status (Active / On Hold / Done), Due, Notes.
- **Tasks** — Task, Project (link), Client (link), Assignee (link → Team Members),
  Status (Backlog / To Do / In Progress / In Review / Done), Priority (Low / Med /
  High / Urgent), Due, Related Brief (link → Send Briefs), Notes.
- Views: Tasks "Board" (kanban by Status), "My week" (grid: Due on_or_before_today,
  not Done), Projects grid.
- The agent can already create/assign/complete tasks through existing tools; automations
  (docs/11) later auto-create tasks (e.g. brief Agreed → task "write it").
- Deliberately NOT the parked 0005 PM schema: engine-native keeps links/views/audit and
  agent-parity for free. Task dependencies + record comments = platform polish backlog.

## Client Portal (external — capability link, no accounts)

Same trust model as public forms: an unguessable token URL, not auth.
- **Enable**: a "Portal" section on the client's record detail generates a token
  (crypto-random, stored in a `Portal token` text field on Clients) → `/c/[token]`.
  Regenerating the token revokes the old link.
- **The page** (bare, branded-clean, read-only except approvals):
  - Their **documents**: Client Docs rows (type, year, link).
  - Their **approvals**: Copy Drafts with Status = In Review — subject/preview/body
    rendered, with **Approve** (→ Status Approved) and **Request changes** (+ comment
    → stored in the draft's Notes, status stays In Review). Actor: `{type:'api',
    id:'portal:<client-record-id>'}` — client actions are distinguishable forever.
  - Monthly Strategies with Status = In Review could join later (the recap is
    explicitly no-approval today).
- **Hygiene**: public error responder (as /f), no schema leakage (whitelisted
  projection), no listing route (token or nothing). Rate limiting: same deferred
  status as forms.
- Later: approval events feed the approvals machinery (docs/11) → Slack notification
  "client approved Email #2 via portal."
