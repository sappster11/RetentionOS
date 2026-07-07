// Automations (docs/11) — shared types + the transactional enqueue hook.
//
// This module is imported by engine.ts's record-mutation transactions, so it must NOT
// import engine.ts (the dispatcher in automations.ts does that side). Everything an
// automation IS lives in data: trigger, condition, actions — never code.

import type { Actor } from './types'
import { matchesLinkFilters } from './linkFilters'
import type { LinkFilterCondition } from './types'
import type { EngineField } from './types'

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type AutomationTrigger =
  | { type: 'record.created' }
  | { type: 'record.updated'; fieldIds?: string[] }
  | { type: 'field.transition'; fieldId: string; to: string; from?: string }
  | { type: 'schedule'; cron: 'daily' | `monthly:${number}` }

export type AutomationAction =
  | { type: 'webhook'; url: string; secretHeader?: { name: string; value: string } }
  | { type: 'create_record'; tableId: string; values: Record<string, unknown> }
  | {
      type: 'update_record'
      target: 'trigger' | { linkFieldId: string }
      values: Record<string, unknown>
    }

export interface EngineAutomation {
  id: string
  organization_id: string
  table_id: string | null
  name: string
  enabled: boolean
  trigger: AutomationTrigger
  condition: LinkFilterCondition[]
  actions: AutomationAction[]
  allow_chained: boolean
  last_fired_at: string | null
  position: number
  created_at: string
  updated_at: string
}

export interface AutomationTriggerEvent {
  type: 'record.created' | 'record.updated' | 'field.transition' | 'schedule'
  tableId: string
  recordId: string
  diff?: Record<string, { from: unknown; to: unknown }>
  actor: Actor
  chainDepth: number
}

export const AUTOMATION_ACTOR_PREFIX = 'automation:'
export const MAX_CHAIN_DEPTH = 3

/** Parse the chain depth out of an automation actor id ("automation:<id>:d2" → 2). */
export function actorChainDepth(actor: Actor): number {
  if (!actor.id || !actor.id.startsWith(AUTOMATION_ACTOR_PREFIX)) return 0
  const m = /:d(\d+)$/.exec(actor.id)
  return m ? Number(m[1]) : 1
}

type TxClient = { query: (t: string, p?: unknown[]) => Promise<{ rows: unknown[] }> }

// ---------------------------------------------------------------------------
// Enqueue — called inside the SAME transaction that wrote the record + revision,
// so an event can never be lost (transactional outbox).
// ---------------------------------------------------------------------------

export async function enqueueAutomationRuns(
  client: TxClient,
  input: {
    orgId: string
    tableId: string
    recordId: string
    op: 'create' | 'update'
    diff: Record<string, { from: unknown; to: unknown }>
    actor: Actor
    /** The record's post-write stored values (concrete fields), for condition matching. */
    values: Record<string, unknown>
    /** The trigger table's fields, for typed condition evaluation. */
    fields: EngineField[]
  },
): Promise<number> {
  const depth = actorChainDepth(input.actor)
  const res = await client.query(
    `select id, trigger, condition, allow_chained from public.engine_automations
     where organization_id = $1 and table_id = $2 and enabled = true`,
    [input.orgId, input.tableId],
  )
  let enqueued = 0
  for (const row of res.rows as Array<{
    id: string
    trigger: AutomationTrigger
    condition: LinkFilterCondition[]
    allow_chained: boolean
  }>) {
    // Loop protection: automation-caused writes only re-trigger opted-in automations,
    // and never past the depth cap.
    if (depth > 0 && (!row.allow_chained || depth >= MAX_CHAIN_DEPTH)) continue

    const t = row.trigger
    let matches = false
    if (t.type === 'record.created') {
      matches = input.op === 'create'
    } else if (t.type === 'record.updated') {
      matches =
        input.op === 'update' &&
        (!t.fieldIds?.length || t.fieldIds.some((id) => id in input.diff))
    } else if (t.type === 'field.transition') {
      const change = input.diff[t.fieldId]
      matches =
        change !== undefined &&
        change.to === t.to &&
        (t.from === undefined || change.from === t.from)
    }
    if (!matches) continue

    if (row.condition?.length) {
      const fieldsById = new Map(input.fields.map((f) => [f.id, f]))
      if (!matchesLinkFilters(input.values, row.condition, fieldsById)) continue
    }

    const event: AutomationTriggerEvent = {
      type:
        t.type === 'field.transition'
          ? 'field.transition'
          : input.op === 'create'
            ? 'record.created'
            : 'record.updated',
      tableId: input.tableId,
      recordId: input.recordId,
      diff: input.diff,
      actor: input.actor,
      chainDepth: depth,
    }
    await client.query(
      `insert into public.engine_automation_runs (automation_id, organization_id, trigger_event)
       values ($1, $2, $3::jsonb)`,
      [row.id, input.orgId, JSON.stringify(event)],
    )
    enqueued += 1
  }
  return enqueued
}
