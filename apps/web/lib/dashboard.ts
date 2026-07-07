// Home-dashboard stats — computed from the engine at request time, each stat
// independently fault-tolerant (a missing table/field → null, never a crash), so the
// dashboard renders on any install regardless of which seeds have run.

import { describeTable, getTableBySlug, queryRecords } from '@retentionos/engine'
import type { EngineField } from '@retentionos/engine'

export interface DashboardStats {
  openPipeline: { count: number; weighted: number } | null
  overdueFollowUps: number | null
  activeClients: number | null
  draftsInReview: number | null
}

const TERMINAL_STAGES = ['closed_won', 'closed_lost', 'passed']

function fieldByName(fields: EngineField[], name: string): EngineField | undefined {
  return fields.find((f) => f.name === name)
}

function choiceIdByName(field: EngineField | undefined, name: string): string | undefined {
  const choices = (field?.options as { choices?: Array<{ id: string; name: string }> })?.choices
  return choices?.find((c) => c.name.toLowerCase().includes(name.toLowerCase()))?.id
}

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch {
    return null
  }
}

export async function dashboardStats(orgId: string): Promise<DashboardStats> {
  const openPipeline = await safe(async () => {
    const leads = await getTableBySlug(orgId, 'leads')
    if (!leads) return null
    const { fields } = await describeTable(orgId, leads.id)
    const stage = fieldByName(fields, 'Stage')
    const weighted = fieldByName(fields, 'Weighted Value')
    if (!stage) return null
    const terminalIds = TERMINAL_STAGES.map((s) => choiceIdByName(stage, s.replace(/_/g, ' '))).filter(
      Boolean,
    ) as string[]
    const page = await queryRecords(orgId, leads.id, {
      filters: terminalIds.map((id) => ({ fieldId: stage.id, op: 'neq' as const, value: id })),
      limit: 500,
    })
    let sum = 0
    if (weighted) {
      for (const r of page.records) {
        const v = (r as { display?: Record<string, unknown> }).display?.[weighted.id]
        if (typeof v === 'number') sum += v
      }
    }
    return { count: page.total, weighted: Math.round(sum) }
  })

  const overdueFollowUps = await safe(async () => {
    const leads = await getTableBySlug(orgId, 'leads')
    if (!leads) return null
    const { fields } = await describeTable(orgId, leads.id)
    const stage = fieldByName(fields, 'Stage')
    const due = fieldByName(fields, 'Next Action Due')
    if (!stage || !due) return null
    const terminalIds = TERMINAL_STAGES.map((s) => choiceIdByName(stage, s.replace(/_/g, ' '))).filter(
      Boolean,
    ) as string[]
    const page = await queryRecords(orgId, leads.id, {
      filters: [
        ...terminalIds.map((id) => ({ fieldId: stage.id, op: 'neq' as const, value: id })),
        { fieldId: due.id, op: 'on_or_before_today' as const },
      ],
      limit: 1,
    })
    return page.total
  })

  const activeClients = await safe(async () => {
    const clients = await getTableBySlug(orgId, 'clients')
    if (!clients) return null
    const { fields } = await describeTable(orgId, clients.id)
    const status = fieldByName(fields, 'Status')
    const active = choiceIdByName(status, 'active')
    if (!status || !active) return null
    const page = await queryRecords(orgId, clients.id, {
      filters: [{ fieldId: status.id, op: 'eq', value: active }],
      limit: 1,
    })
    return page.total
  })

  const draftsInReview = await safe(async () => {
    const drafts = await getTableBySlug(orgId, 'copy-drafts')
    if (!drafts) return null
    const { fields } = await describeTable(orgId, drafts.id)
    const status = fieldByName(fields, 'Status')
    const inReview = choiceIdByName(status, 'in review')
    if (!status || !inReview) return null
    const page = await queryRecords(orgId, drafts.id, {
      filters: [{ fieldId: status.id, op: 'eq', value: inReview }],
      limit: 1,
    })
    return page.total
  })

  return {
    openPipeline: openPipeline ?? null,
    overdueFollowUps: overdueFollowUps ?? null,
    activeClients: activeClients ?? null,
    draftsInReview: draftsInReview ?? null,
  }
}
