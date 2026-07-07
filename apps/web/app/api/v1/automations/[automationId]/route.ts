import {
  deleteAutomation,
  getAutomation,
  listAutomationRuns,
  updateAutomation,
} from '@retentionos/engine'
import type { AutomationAction, AutomationTrigger, LinkFilterCondition } from '@retentionos/engine'
import { errorResponse, json, readJson } from '@/lib/api'
import { getCurrentOrg } from '@/lib/org'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ automationId: string }> }

export async function GET(req: Request, ctx: Ctx) {
  try {
    const { automationId } = await ctx.params
    const org = await getCurrentOrg()
    const withRuns = new URL(req.url).searchParams.get('runs') === '1'
    const automation = await getAutomation(org.id, automationId)
    const runs = withRuns ? await listAutomationRuns(org.id, { automationId }) : undefined
    return json({ automation, ...(runs ? { runs } : {}) })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { automationId } = await ctx.params
    const org = await getCurrentOrg()
    const body = await readJson(req)
    const automation = await updateAutomation(org.id, automationId, {
      name: body.name === undefined ? undefined : String(body.name),
      enabled: body.enabled === undefined ? undefined : Boolean(body.enabled),
      trigger: body.trigger as AutomationTrigger | undefined,
      condition: body.condition as LinkFilterCondition[] | undefined,
      actions: body.actions as AutomationAction[] | undefined,
      allowChained: body.allowChained === undefined ? undefined : Boolean(body.allowChained),
    })
    return json({ automation })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { automationId } = await ctx.params
    const org = await getCurrentOrg()
    await deleteAutomation(org.id, automationId)
    return json({ deleted: true })
  } catch (err) {
    return errorResponse(err)
  }
}
