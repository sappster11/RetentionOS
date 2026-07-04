# Phase 2 — Agentic Project Management

**Goal:** projects and tasks that live on top of the CRM and can be **driven by an agent** — proposed,
created, assigned, and rolled up — with a human approving the meaningful moves.

**Why now:** the CRM (Phase 1) gives us clients and activity. PM turns "what's happening with this
client" into "what we're doing about it." It's the first subsystem where agents *act*, not just read.

**Prerequisites:** Phase 1 complete (`clients`, `activities`, `mcp-crm`, RAG v1).

**Read first:** [docs/03-data-model.md](../docs/03-data-model.md),
[docs/04-ai-and-agent-layer.md](../docs/04-ai-and-agent-layer.md).

---

## Tasks

### 2.1 — PM schema
- [ ] Migration: `projects`, `tasks`, `task_dependencies`, `task_comments` — each with
      `organization_id`, `updated_at` triggers, and **RLS in the same migration**.
- [ ] `projects`: `client_id → clients`, `name`, `status`, `owner_id`, `starts_on`, `due_on`,
      `metadata`.
- [ ] `tasks`: `project_id → projects` (nullable for standalone), `client_id`, `title`, `details`,
      `status`, `priority`, `assignee_id → users`, `due_on`, `completed_at`, `created_by_type`
      (user|agent), `metadata`.
- [ ] `task_dependencies`: `task_id`, `depends_on_task_id` (blocks/blocked-by).
- [ ] `task_comments`: `task_id`, `author_type` (user|agent), `author_id`, `body`.
- [ ] Enums: project `status` {planned, active, on_hold, done, cancelled}; task `status` {todo,
      in_progress, blocked, review, done}; `priority` {low, med, high, urgent}.
- [ ] Regenerate `packages/db` types.
- **Acceptance:** migrations apply to a fresh DB; RLS test proves cross-org isolation; a task can be
      created under a client and appears scoped correctly.

### 2.2 — PM UI
- [ ] Per-client **project board** (Kanban by task `status`) and a **task list** (sortable/filterable
      by assignee, priority, due date).
- [ ] Task detail: edit fields, assign, set due date, add comments, view dependencies.
- [ ] A cross-client "My tasks" / "Overdue" view for the team.
- [ ] Any create/complete/assign writes an `activities` row on the client.
- **Acceptance:** you can run a client's work entirely from the UI; overdue tasks surface; timeline
      reflects task events.

### 2.3 — `mcp-pm` server
- [ ] Read tools: `list_tasks` (filter by client/project/assignee/status), `get_task`,
      `list_overdue`, `project_status` (roll-up summary).
- [ ] Write tools: `create_task`, `update_task`, `assign_task`, `complete_task`, `add_comment`,
      `add_dependency`.
- [ ] Resources: `project://{id}`, `task://{id}`.
- [ ] Tenant-safe; every mutation writes an `activities` row (`actor_type='agent'`).
- **Acceptance:** from Claude *and* an OpenAI-based agent you can list overdue tasks, create a task
      under a client, assign it, and complete it — all reflected in the UI and timeline.

### 2.4 — Agent workflow: propose the week's tasks
- [ ] A flow: given a client, the agent reads recent `activities` (via `mcp-crm`) + open tasks (via
      `mcp-pm`) and **proposes** a task list (title, priority, suggested owner, due date) as
      structured output.
- [ ] Human reviews in the UI and approves; on approval the agent creates the tasks via `create_task`.
- [ ] Nothing is created without explicit human approval.
- **Acceptance:** for a real client, the agent proposes a sensible task list grounded in that client's
      activity; approving it materializes the tasks on the board with owners and dates.

### 2.5 — Agent workflow: status roll-up
- [ ] A flow that generates a client/project status summary (what moved, what's blocked, what's due)
      from `mcp-pm` + `activities`, and writes it as an `activity` and/or a draft update.
- **Acceptance:** "summarize project status for Client X" produces an accurate roll-up grounded in
      real task data, with no invented items.

---

## Phase 2 exit criteria (milestone demo)
For a real client:
1. An agent reads recent activity and **proposes** this week's task list.
2. You approve; tasks appear on the board with owners and due dates.
3. A status roll-up writes itself, grounded in real task data — and everything the agent did is
   visible in the client timeline, attributed to the agent.

When all three work, Phase 2 is done. Next: [phases/phase-03-client-data-analytics.md](phase-03-client-data-analytics.md)
— ingest Shopify/Klaviyo so the content engine has real data to write from.

## Notes / decisions log
> Record status/priority enum tweaks, approval-UX choices, and any deviations here.
