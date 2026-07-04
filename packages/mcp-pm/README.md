# @retentionos/mcp-pm

The PM (project management) Model Context Protocol server. Lets an agent run project
management — list/create/update tasks, assign and complete them, comment, record
dependencies, and roll up project status — the same way a human would in the app. Same
tools, every agent — this is the "works with any model" layer in practice
(docs/04-ai-and-agent-layer.md).

Backed by `@retentionos/db`, the same shared data-access layer the web app uses, talking to
the owned Postgres via `DATABASE_URL`.

## Tools

- `list_tasks` — list tasks, optionally filtered by `client_id`, `project_id`,
  `assignee_id`, `status`, or `overdue_only`.
- `get_task` — fetch a single task by id, including its comment thread.
- `list_overdue_tasks` — cross-client list of every open, past-due task.
- `create_task` — create a task (title required; status defaults to "todo", priority to
  "medium"). Marks it `created_by_type: "agent"` and logs a `task.created` activity.
- `update_task` — patch status/priority/title/details/due_on on a task. Logs a
  `task.updated` activity with the changed fields.
- `assign_task` — assign a task to a user/agent id. Logs a `task.assigned` activity.
- `complete_task` — mark a task done (stamps `completed_at`). Logs a `task.completed`
  activity.
- `add_comment` — add a comment to a task (author `agent`). Logs a `task.commented`
  activity.
- `add_dependency` — record that a task depends on another task. Logs a
  `task.dependency_added` activity.
- `list_projects` — list projects, optionally filtered by `client_id`.
- `project_status` — roll up a project's tasks: counts by status, total tasks, overdue
  count.

Every tool takes an optional `organization_id`; when omitted it resolves to
`RETENTIONOS_ORG_ID`, then the first organization in the database. This keeps every call
tenant-scoped even when this server bypasses row-level security.

Every mutating tool logs an activity with `actor_type: "agent"` to the client timeline (via
`logActivity`), so agent-driven PM work shows up in the same history as human activity.

## Resources

- `task://{id}` — a single task as JSON.
- `project://{id}` — a single project as JSON.

## Run it

```bash
# needs DATABASE_URL (and optionally RETENTIONOS_ORG_ID to pin a default org)
pnpm --filter @retentionos/mcp-pm start
```

## Connect from Claude Desktop
Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "retentionos-pm": {
      "command": "pnpm",
      "args": ["--filter", "@retentionos/mcp-pm", "start"],
      "env": {
        "DATABASE_URL": "postgresql://ros:ros@127.0.0.1:5432/retentionos",
        "RETENTIONOS_ORG_ID": "…"
      }
    }
  }
}
```

## Connect from OpenAI
OpenAI's Agents SDK supports MCP servers directly (point it at this stdio command), or wrap the
tool as an OpenAI function tool via a thin adapter. Either way it calls the **same** tools —
one PM tool surface, driven from two vendors.
