// Automations (docs/11) — CRUD, validation, and the dispatcher. The enqueue side lives
// in automationShared.ts (imported by engine.ts's transactions); this side may import
// engine.ts freely. Agent-parity: this is the ONE service layer for automations — the
// REST API, the MCP tools, and any future UI all call these functions.

import { getPool } from '@retentionos/db'
import {
  createRecord,
  describeTable,
  getRecordEnriched,
  getTable,
  queryRecords,
  updateRecord,
} from './engine'
import { EngineError } from './types'
import type { Actor, EngineField, LinkFilterCondition } from './types'
import { validateLinkFilters } from './linkFilters'
import {
  AUTOMATION_ACTOR_PREFIX,
  MAX_CHAIN_DEPTH,
  type AutomationAction,
  type AutomationTrigger,
  type AutomationTriggerEvent,
  type EngineAutomation,
} from './automationShared'

const AUTOMATION_COLS =
  'id, organization_id, table_id, name, enabled, trigger, condition, actions, allow_chained, last_fired_at, position, created_at, updated_at'

export interface AutomationRun {
  id: string
  automation_id: string
  organization_id: string
  trigger_event: AutomationTriggerEvent
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'dead'
  attempts: number
  next_attempt_at: string
  last_error: string | null
  created_at: string
  finished_at: string | null
}

// ---------------------------------------------------------------------------
// Validation — every shape checked against the live schema, so a bad automation
// can't be saved (by human, agent, or API alike).
// ---------------------------------------------------------------------------

const MONTHLY_RE = /^monthly:([1-9]|1\d|2[0-8])$/

async function validateAutomation(
  orgId: string,
  input: {
    tableId: string | null
    trigger: AutomationTrigger
    condition: LinkFilterCondition[]
    actions: AutomationAction[]
  },
): Promise<void> {
  const t = input.trigger as AutomationTrigger & { type?: string }
  const kinds = ['record.created', 'record.updated', 'field.transition', 'schedule']
  if (!t || !kinds.includes(t.type as string)) {
    throw new EngineError(`trigger.type must be one of ${kinds.join(', ')}.`, 'bad_input')
  }
  if (!input.tableId) {
    throw new EngineError('Automations attach to a table (table_id is required).', 'bad_input')
  }
  const desc = await describeTable(orgId, input.tableId)
  const fieldById = new Map(desc.fields.map((f) => [f.id, f]))

  if (t.type === 'record.updated' && t.fieldIds) {
    for (const id of t.fieldIds) {
      if (!fieldById.has(id)) throw new EngineError(`trigger.fieldIds: unknown field ${id}.`, 'bad_input')
    }
  }
  if (t.type === 'field.transition') {
    const f = fieldById.get(t.fieldId)
    if (!f || f.type !== 'single_select') {
      throw new EngineError('field.transition requires a single_select fieldId on the table.', 'bad_input')
    }
    const choices = (f.options as { choices?: Array<{ id: string }> }).choices ?? []
    for (const [label, val] of [
      ['to', t.to],
      ['from', t.from],
    ] as const) {
      if (val !== undefined && !choices.some((c) => c.id === val)) {
        throw new EngineError(`field.transition.${label}: "${val}" is not a choice id on that field.`, 'bad_input')
      }
    }
  }
  if (t.type === 'schedule') {
    if (t.cron !== 'daily' && !MONTHLY_RE.test(t.cron)) {
      throw new EngineError('schedule.cron must be "daily" or "monthly:<1-28>".', 'bad_input')
    }
  }

  // Conditions: view-filter grammar over the trigger table's concrete fields.
  const conditions = validateLinkFilters(input.condition ?? [])
  for (const c of conditions) {
    if (!fieldById.has(c.fieldId)) {
      throw new EngineError(`condition: unknown field ${c.fieldId} on the trigger table.`, 'bad_input')
    }
  }

  if (!Array.isArray(input.actions) || input.actions.length === 0) {
    throw new EngineError('At least one action is required.', 'bad_input')
  }
  for (const a of input.actions) {
    if (a.type === 'webhook') {
      if (!/^https?:\/\//.test(a.url ?? '')) {
        throw new EngineError('webhook.url must be an http(s) URL.', 'bad_input')
      }
    } else if (a.type === 'create_record') {
      const target = await getTable(orgId, a.tableId ?? '')
      if (!target) throw new EngineError(`create_record: unknown table ${a.tableId}.`, 'bad_input')
      const targetFields = new Set((await describeTable(orgId, target.id)).fields.map((f) => f.id))
      for (const id of Object.keys(a.values ?? {})) {
        if (!targetFields.has(id)) {
          throw new EngineError(`create_record.values: unknown field ${id} on ${target.name}.`, 'bad_input')
        }
      }
    } else if (a.type === 'update_record') {
      if (a.target !== 'trigger') {
        const lf = fieldById.get((a.target as { linkFieldId: string })?.linkFieldId ?? '')
        if (!lf || lf.type !== 'linked_record') {
          throw new EngineError('update_record.target.linkFieldId must be a linked_record field on the trigger table.', 'bad_input')
        }
      }
      for (const id of Object.keys(a.values ?? {})) {
        if (a.target === 'trigger' && !fieldById.has(id)) {
          throw new EngineError(`update_record.values: unknown field ${id} on the trigger table.`, 'bad_input')
        }
      }
    } else {
      throw new EngineError(`Unknown action type "${(a as { type?: string }).type}".`, 'bad_input')
    }
  }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createAutomation(
  orgId: string,
  input: {
    tableId: string
    name: string
    trigger: AutomationTrigger
    condition?: LinkFilterCondition[]
    actions: AutomationAction[]
    enabled?: boolean
    allowChained?: boolean
  },
  actor: Actor,
): Promise<EngineAutomation> {
  if (!input.name?.trim()) throw new EngineError('Automation name is required.', 'bad_input')
  await validateAutomation(orgId, {
    tableId: input.tableId,
    trigger: input.trigger,
    condition: input.condition ?? [],
    actions: input.actions,
  })
  const pool = getPool()
  const res = await pool.query(
    `insert into public.engine_automations
       (organization_id, table_id, name, enabled, trigger, condition, actions, allow_chained, created_by_type, created_by_id)
     values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9::public.engine_actor_type,$10)
     returning ${AUTOMATION_COLS}`,
    [
      orgId,
      input.tableId,
      input.name.trim(),
      input.enabled ?? true,
      JSON.stringify(input.trigger),
      JSON.stringify(input.condition ?? []),
      JSON.stringify(input.actions),
      input.allowChained ?? false,
      actor.type,
      actor.id ?? null,
    ],
  )
  return res.rows[0] as EngineAutomation
}

export async function updateAutomation(
  orgId: string,
  automationId: string,
  patch: {
    name?: string
    enabled?: boolean
    trigger?: AutomationTrigger
    condition?: LinkFilterCondition[]
    actions?: AutomationAction[]
    allowChained?: boolean
  },
): Promise<EngineAutomation> {
  const existing = await getAutomation(orgId, automationId)
  const merged = {
    tableId: existing.table_id,
    trigger: patch.trigger ?? existing.trigger,
    condition: patch.condition ?? existing.condition,
    actions: patch.actions ?? existing.actions,
  }
  if (patch.trigger || patch.condition || patch.actions) await validateAutomation(orgId, merged)

  const pool = getPool()
  const res = await pool.query(
    `update public.engine_automations set
       name = coalesce($3, name),
       enabled = coalesce($4, enabled),
       trigger = coalesce($5::jsonb, trigger),
       condition = coalesce($6::jsonb, condition),
       actions = coalesce($7::jsonb, actions),
       allow_chained = coalesce($8, allow_chained)
     where organization_id = $1 and id = $2
     returning ${AUTOMATION_COLS}`,
    [
      orgId,
      automationId,
      patch.name?.trim() ?? null,
      patch.enabled ?? null,
      patch.trigger ? JSON.stringify(patch.trigger) : null,
      patch.condition ? JSON.stringify(patch.condition) : null,
      patch.actions ? JSON.stringify(patch.actions) : null,
      patch.allowChained ?? null,
    ],
  )
  if (!res.rows[0]) throw new EngineError('Automation not found.', 'not_found')
  return res.rows[0] as EngineAutomation
}

export async function deleteAutomation(orgId: string, automationId: string): Promise<void> {
  const pool = getPool()
  const res = await pool.query(
    `delete from public.engine_automations where organization_id = $1 and id = $2 returning id`,
    [orgId, automationId],
  )
  if (!res.rows[0]) throw new EngineError('Automation not found.', 'not_found')
}

export async function getAutomation(orgId: string, automationId: string): Promise<EngineAutomation> {
  const pool = getPool()
  const res = await pool.query(
    `select ${AUTOMATION_COLS} from public.engine_automations where organization_id = $1 and id = $2`,
    [orgId, automationId],
  )
  if (!res.rows[0]) throw new EngineError('Automation not found.', 'not_found')
  return res.rows[0] as EngineAutomation
}

export async function listAutomations(
  orgId: string,
  opts: { tableId?: string } = {},
): Promise<EngineAutomation[]> {
  const pool = getPool()
  const res = opts.tableId
    ? await pool.query(
        `select ${AUTOMATION_COLS} from public.engine_automations
         where organization_id = $1 and table_id = $2 order by position, created_at`,
        [orgId, opts.tableId],
      )
    : await pool.query(
        `select ${AUTOMATION_COLS} from public.engine_automations
         where organization_id = $1 order by position, created_at`,
        [orgId],
      )
  return res.rows as EngineAutomation[]
}

export async function listAutomationRuns(
  orgId: string,
  opts: { automationId?: string; limit?: number } = {},
): Promise<AutomationRun[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  const pool = getPool()
  const res = opts.automationId
    ? await pool.query(
        `select * from public.engine_automation_runs
         where organization_id = $1 and automation_id = $2 order by created_at desc limit $3`,
        [orgId, opts.automationId, limit],
      )
    : await pool.query(
        `select * from public.engine_automation_runs
         where organization_id = $1 order by created_at desc limit $2`,
        [orgId, limit],
      )
  return res.rows as AutomationRun[]
}

// ---------------------------------------------------------------------------
// Dispatcher — claims queued runs (SKIP LOCKED, serverless-safe), executes actions
// in order, retries with quadratic backoff, dead-letters after 5 attempts.
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 5

function substituteTokens(value: unknown, triggerValues: Record<string, unknown>): unknown {
  if (typeof value !== 'string') return value
  return value.replace(/\{fld:([0-9a-f-]{36})\}/gi, (_m, id: string) => {
    const v = triggerValues[id]
    if (v == null) return ''
    if (Array.isArray(v)) return v.join(', ')
    return String(v)
  })
}

async function executeAction(
  orgId: string,
  automation: EngineAutomation,
  action: AutomationAction,
  event: AutomationTriggerEvent,
  triggerValues: Record<string, unknown>,
  triggerFields: EngineField[],
  actor: Actor,
): Promise<void> {
  if (action.type === 'webhook') {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      const fieldNames = Object.fromEntries(triggerFields.map((f) => [f.id, f.name]))
      const res = await fetch(action.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(action.secretHeader ? { [action.secretHeader.name]: action.secretHeader.value } : {}),
        },
        body: JSON.stringify({
          automation: { id: automation.id, name: automation.name },
          event,
          record: { id: event.recordId, tableId: event.tableId, values: triggerValues, fieldNames },
        }),
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`webhook ${action.url} responded ${res.status}`)
    } finally {
      clearTimeout(timer)
    }
    return
  }

  if (action.type === 'create_record') {
    const values: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(action.values)) values[k] = substituteTokens(v, triggerValues)
    await createRecord(orgId, action.tableId, values, actor)
    return
  }

  // update_record
  const values: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(action.values)) values[k] = substituteTokens(v, triggerValues)
  if (action.target === 'trigger') {
    await updateRecord(orgId, event.tableId, event.recordId, values, actor)
    return
  }
  const linkFieldId = action.target.linkFieldId
  const linkIds = (triggerValues[linkFieldId] as string[] | undefined) ?? []
  const linkField = triggerFields.find((f) => f.id === linkFieldId)
  const targetTableId = (linkField?.options as { linkedTableId?: string })?.linkedTableId
  if (!targetTableId) throw new Error('update_record: link field no longer resolves to a table')
  for (const id of linkIds) {
    await updateRecord(orgId, targetTableId, id, values, actor)
  }
}

/** Materialize due schedule-trigger runs (watermark on last_fired_at), then claim and
 * execute queued runs. Returns counts for observability. */
export async function drainAutomationRuns(
  opts: { limit?: number; now?: Date } = {},
): Promise<{ scheduled: number; executed: number; failed: number }> {
  const now = opts.now ?? new Date()
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100)
  const pool = getPool()
  let scheduled = 0

  // 1. Schedule materialization.
  const due = await pool.query(
    `select ${AUTOMATION_COLS} from public.engine_automations
     where enabled = true and trigger->>'type' = 'schedule'`,
  )
  for (const a of due.rows as EngineAutomation[]) {
    const cron = (a.trigger as { cron: string }).cron
    const last = a.last_fired_at ? new Date(a.last_fired_at) : null
    const todayUtc = now.toISOString().slice(0, 10)
    let fire = false
    if (cron === 'daily') {
      fire = !last || last.toISOString().slice(0, 10) < todayUtc
    } else {
      const day = Number(cron.split(':')[1])
      const sameMonth =
        last &&
        last.getUTCFullYear() === now.getUTCFullYear() &&
        last.getUTCMonth() === now.getUTCMonth()
      fire = now.getUTCDate() >= day && !sameMonth
    }
    if (!fire || !a.table_id) continue

    const page = await queryRecords(a.organization_id, a.table_id, {
      filters: a.condition ?? [],
      limit: 500,
    })
    for (const r of page.records) {
      const event: AutomationTriggerEvent = {
        type: 'schedule',
        tableId: a.table_id,
        recordId: r.id,
        actor: { type: 'agent', id: `${AUTOMATION_ACTOR_PREFIX}${a.id}` },
        chainDepth: 0,
      }
      await pool.query(
        `insert into public.engine_automation_runs (automation_id, organization_id, trigger_event)
         values ($1,$2,$3::jsonb)`,
        [a.id, a.organization_id, JSON.stringify(event)],
      )
      scheduled += 1
    }
    await pool.query(`update public.engine_automations set last_fired_at = $2 where id = $1`, [
      a.id,
      now.toISOString(),
    ])
  }

  // 2. Claim + execute.
  let executed = 0
  let failed = 0
  for (let i = 0; i < limit; i++) {
    const client = await pool.connect()
    let run: AutomationRun | null = null
    try {
      await client.query('begin')
      const claimed = await client.query(
        `select * from public.engine_automation_runs
         where status = 'queued' and next_attempt_at <= now()
         order by created_at
         for update skip locked
         limit 1`,
      )
      run = (claimed.rows[0] as AutomationRun) ?? null
      if (run) {
        await client.query(
          `update public.engine_automation_runs set status = 'running' where id = $1`,
          [run.id],
        )
        await client.query('commit')
      } else {
        await client.query('rollback')
      }
    } catch (err) {
      await client.query('rollback').catch(() => {})
      throw err
    } finally {
      client.release()
    }
    if (!run) break

    const event = run.trigger_event
    try {
      const automation = await getAutomation(run.organization_id, run.automation_id)
      if (!automation.enabled) throw new Error('automation disabled')
      const rec = await getRecordEnriched(run.organization_id, event.tableId, event.recordId)
      if (!rec) throw new Error('trigger record no longer exists')
      const { fields } = await describeTable(run.organization_id, event.tableId)
      const depth = event.chainDepth ?? 0
      const actor: Actor = {
        type: 'agent',
        id: `${AUTOMATION_ACTOR_PREFIX}${automation.id}:d${depth + 1}`,
      }
      for (const action of automation.actions) {
        await executeAction(run.organization_id, automation, action, event, rec.values, fields, actor)
      }
      await pool.query(
        `update public.engine_automation_runs
         set status = 'succeeded', attempts = attempts + 1, finished_at = now(), last_error = null
         where id = $1`,
        [run.id],
      )
      executed += 1
    } catch (err) {
      failed += 1
      const message = err instanceof Error ? err.message : String(err)
      const attempts = run.attempts + 1
      if (attempts >= MAX_ATTEMPTS) {
        await pool.query(
          `update public.engine_automation_runs
           set status = 'dead', attempts = $2, finished_at = now(), last_error = $3
           where id = $1`,
          [run.id, attempts, message.slice(0, 2000)],
        )
      } else {
        const backoffSecs = attempts * attempts * 30
        await pool.query(
          `update public.engine_automation_runs
           set status = 'queued', attempts = $2, last_error = $3,
               next_attempt_at = now() + make_interval(secs => $4)
           where id = $1`,
          [run.id, attempts, message.slice(0, 2000), backoffSecs],
        )
      }
    }
  }

  return { scheduled, executed, failed }
}
