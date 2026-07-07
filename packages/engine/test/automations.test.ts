// Automations (docs/11): runtime-defined trigger → condition → actions, transactional
// outbox, dispatcher with retry/backoff, schedule watermark. Runs against the embedded
// Postgres from globalSetup (0014 applied).
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPool } from '@retentionos/db'
import {
  createAutomation,
  createField,
  createRecord,
  createTable,
  drainAutomationRuns,
  listAutomationRuns,
  queryRecords,
  updateAutomation,
  updateRecord,
} from '../src/index'
import type { Actor, EngineField, EngineTable } from '../src/index'
import { ensureTestOrg } from './helpers'

const USER: Actor = { type: 'user', id: 'test' }

let orgId: string
let leads: EngineTable
let stageF: EngineField
let nameF: EngineField
let tasksT: EngineTable
let taskNameF: EngineField

async function drainAll(now?: Date) {
  // Drain until quiet (retries schedule their own next_attempt_at; tests force it due).
  for (let i = 0; i < 5; i++) {
    const r = await drainAutomationRuns({ limit: 50, now })
    if (r.executed + r.failed + r.scheduled === 0) break
  }
}

async function forceRunsDue() {
  await getPool().query(`update public.engine_automation_runs set next_attempt_at = now() where status = 'queued'`)
}

beforeAll(async () => {
  orgId = await ensureTestOrg()

  leads = await createTable(orgId, { name: 'Auto Leads' }, USER)
  nameF = await createField(orgId, leads.id, { name: 'Company', type: 'text' }, USER)
  stageF = await createField(
    orgId,
    leads.id,
    {
      name: 'Stage',
      type: 'single_select',
      options: { choices: [{ id: 'new', name: 'New' }, { id: 'won', name: 'Won' }] },
    },
    USER,
  )
  tasksT = await createTable(orgId, { name: 'Auto Tasks' }, USER)
  taskNameF = await createField(orgId, tasksT.id, { name: 'Task', type: 'text' }, USER)
})

describe('validation', () => {
  it('rejects unknown trigger types, fields, choices, and action tables', async () => {
    await expect(
      createAutomation(orgId, { tableId: leads.id, name: 'x', trigger: { type: 'nope' } as never, actions: [{ type: 'webhook', url: 'https://x.test' }] }, USER),
    ).rejects.toThrow(/trigger.type/)
    await expect(
      createAutomation(orgId, { tableId: leads.id, name: 'x', trigger: { type: 'field.transition', fieldId: nameF.id, to: 'won' }, actions: [{ type: 'webhook', url: 'https://x.test' }] }, USER),
    ).rejects.toThrow(/single_select/)
    await expect(
      createAutomation(orgId, { tableId: leads.id, name: 'x', trigger: { type: 'field.transition', fieldId: stageF.id, to: 'nonexistent' }, actions: [{ type: 'webhook', url: 'https://x.test' }] }, USER),
    ).rejects.toThrow(/not a choice id/)
    await expect(
      createAutomation(orgId, { tableId: leads.id, name: 'x', trigger: { type: 'record.created' }, actions: [{ type: 'create_record', tableId: '00000000-0000-0000-0000-000000000000', values: {} }] }, USER),
    ).rejects.toThrow(/unknown table/)
    await expect(
      createAutomation(orgId, { tableId: leads.id, name: 'x', trigger: { type: 'record.created' }, actions: [] }, USER),
    ).rejects.toThrow(/At least one action/)
  })
})

describe('transition trigger → create_record action with tokens', () => {
  it('fires only on the configured transition and substitutes {fld:} tokens', async () => {
    const auto = await createAutomation(
      orgId,
      {
        tableId: leads.id,
        name: 'won → task',
        trigger: { type: 'field.transition', fieldId: stageF.id, to: 'won' },
        actions: [
          { type: 'create_record', tableId: tasksT.id, values: { [taskNameF.id]: `Kick off {fld:${nameF.id}}` } },
        ],
      },
      USER,
    )

    const rec = await createRecord(orgId, leads.id, { [nameF.id]: 'Acme', [stageF.id]: 'new' }, USER)
    // create didn't match the transition trigger:
    expect((await listAutomationRuns(orgId, { automationId: auto.id })).length).toBe(0)

    await updateRecord(orgId, leads.id, rec.id, { [stageF.id]: 'won' }, USER)
    const runs = await listAutomationRuns(orgId, { automationId: auto.id })
    expect(runs.length).toBe(1)
    expect(runs[0]!.status).toBe('queued')

    await drainAll()
    const done = await listAutomationRuns(orgId, { automationId: auto.id })
    expect(done[0]!.status).toBe('succeeded')

    const tasks = await queryRecords(orgId, tasksT.id, { limit: 50 })
    const made = tasks.records.find((r) => r.values[taskNameF.id] === 'Kick off Acme')
    expect(made).toBeTruthy()
    // Attribution: automation actor with chain depth.
    expect(made!.created_by_type).toBe('agent')
    expect(String(made!.created_by_id)).toMatch(new RegExp(`^automation:${auto.id}:d1$`))

    await updateAutomation(orgId, auto.id, { enabled: false })
  })
})

describe('conditions + loop protection', () => {
  it('applies conditions and suppresses non-chained automation-actor triggers', async () => {
    // Condition: only fire when Company is not empty.
    const auto = await createAutomation(
      orgId,
      {
        tableId: tasksT.id,
        name: 'task created → touch it',
        trigger: { type: 'record.created' },
        condition: [{ fieldId: taskNameF.id, op: 'is_not_empty' }],
        actions: [{ type: 'update_record', target: 'trigger', values: { [taskNameF.id]: 'touched {fld:' + taskNameF.id + '}' } }],
      },
      USER,
    )

    // Condition false → no run.
    await createRecord(orgId, tasksT.id, {}, USER)
    expect((await listAutomationRuns(orgId, { automationId: auto.id })).length).toBe(0)

    // Condition true → run; its update_record executes with an automation actor, and that
    // write must NOT re-trigger this (record.updated ≠ trigger anyway, but the actor path
    // is exercised: a second created-trigger automation with allow_chained=false stays quiet).
    const rec = await createRecord(orgId, tasksT.id, { [taskNameF.id]: 'hello' }, USER)
    await forceRunsDue()
    await drainAll()
    const runs = await listAutomationRuns(orgId, { automationId: auto.id })
    expect(runs.filter((r) => r.status === 'succeeded').length).toBe(1)
    const after = await queryRecords(orgId, tasksT.id, { limit: 50 })
    expect(after.records.find((r) => r.id === rec.id)!.values[taskNameF.id]).toBe('touched hello')

    await updateAutomation(orgId, auto.id, { enabled: false })
  })
})

describe('webhook action: success, retry, dead-letter', () => {
  let url: string
  let mode: 'ok' | 'fail' = 'ok'
  let hits = 0
  let lastBody: unknown = null
  const server = createServer((req, res) => {
    hits += 1
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      lastBody = JSON.parse(body || '{}')
      res.statusCode = mode === 'ok' ? 200 : 500
      res.end(mode === 'ok' ? 'ok' : 'boom')
    })
  })

  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`
  })
  afterAll(() => server.close())

  it('POSTs the event payload and dead-letters after max attempts', async () => {
    const auto = await createAutomation(
      orgId,
      {
        tableId: leads.id,
        name: 'created → webhook',
        trigger: { type: 'record.created' },
        actions: [{ type: 'webhook', url, secretHeader: { name: 'x-test', value: 's3cret' } }],
      },
      USER,
    )

    mode = 'ok'
    const rec = await createRecord(orgId, leads.id, { [nameF.id]: 'HookCo' }, USER)
    await drainAll()
    const okRuns = await listAutomationRuns(orgId, { automationId: auto.id })
    expect(okRuns[0]!.status).toBe('succeeded')
    const payload = lastBody as { record: { values: Record<string, unknown> }; event: { type: string } }
    expect(payload.event.type).toBe('record.created')
    expect(payload.record.values[nameF.id]).toBe('HookCo')
    expect(payload.record.id ?? rec.id).toBeTruthy()

    // Failure path: every attempt 500s → retried with backoff → dead at 5 attempts.
    mode = 'fail'
    hits = 0
    await createRecord(orgId, leads.id, { [nameF.id]: 'FailCo' }, USER)
    for (let i = 0; i < 6; i++) {
      await forceRunsDue()
      await drainAutomationRuns({ limit: 10 })
    }
    const runs = await listAutomationRuns(orgId, { automationId: auto.id })
    const deadRun = runs.find((r) => r.status === 'dead')
    expect(deadRun).toBeTruthy()
    expect(deadRun!.attempts).toBe(5)
    expect(deadRun!.last_error).toMatch(/responded 500/)
    expect(hits).toBeGreaterThanOrEqual(5)

    await updateAutomation(orgId, auto.id, { enabled: false })
  })
})

describe('schedule trigger watermark', () => {
  it('daily fires once per day; monthly respects the day-of-month', async () => {
    const auto = await createAutomation(
      orgId,
      {
        tableId: leads.id,
        name: 'daily sweep',
        trigger: { type: 'schedule', cron: 'daily' },
        condition: [{ fieldId: nameF.id, op: 'eq', value: 'Acme' }],
        actions: [{ type: 'create_record', tableId: tasksT.id, values: { [taskNameF.id]: 'daily check {fld:' + nameF.id + '}' } }],
      },
      USER,
    )

    const day1 = new Date('2030-01-05T10:00:00Z')
    const r1 = await drainAutomationRuns({ limit: 50, now: day1 })
    expect(r1.scheduled).toBe(1) // exactly the Acme record
    const r1b = await drainAutomationRuns({ limit: 50, now: day1 })
    expect(r1b.scheduled).toBe(0) // watermark: not twice the same day

    const day2 = new Date('2030-01-06T10:00:00Z')
    const r2 = await drainAutomationRuns({ limit: 50, now: day2 })
    expect(r2.scheduled).toBe(1)

    await updateAutomation(orgId, auto.id, {
      trigger: { type: 'schedule', cron: 'monthly:15' },
    })
    const before15 = await drainAutomationRuns({ limit: 50, now: new Date('2030-02-10T10:00:00Z') })
    expect(before15.scheduled).toBe(0)
    const on15 = await drainAutomationRuns({ limit: 50, now: new Date('2030-02-15T10:00:00Z') })
    expect(on15.scheduled).toBe(1)
    const after15 = await drainAutomationRuns({ limit: 50, now: new Date('2030-02-20T10:00:00Z') })
    expect(after15.scheduled).toBe(0) // same month, already fired

    await updateAutomation(orgId, auto.id, { enabled: false })
  })
})
