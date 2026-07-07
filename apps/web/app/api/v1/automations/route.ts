// Automations CRUD (docs/11): thin over @retentionos/engine, same conventions as bases.
import { createAutomation, listAutomations } from '@retentionos/engine'
import type { AutomationAction, AutomationTrigger } from '@retentionos/engine'
import type { LinkFilterCondition } from '@retentionos/engine'
import { API_ACTOR, errorResponse, json, readJson } from '@/lib/api'
import { getCurrentOrg } from '@/lib/org'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const org = await getCurrentOrg()
    const tableId = new URL(req.url).searchParams.get('tableId') ?? undefined
    return json({ automations: await listAutomations(org.id, { tableId }) })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: Request) {
  try {
    const org = await getCurrentOrg()
    const body = await readJson(req)
    const automation = await createAutomation(
      org.id,
      {
        tableId: String(body.tableId ?? ''),
        name: String(body.name ?? ''),
        trigger: body.trigger as AutomationTrigger,
        condition: (body.condition as LinkFilterCondition[]) ?? [],
        actions: (body.actions as AutomationAction[]) ?? [],
        enabled: body.enabled === undefined ? true : Boolean(body.enabled),
        allowChained: Boolean(body.allowChained),
      },
      API_ACTOR,
    )
    return json({ automation }, 201)
  } catch (err) {
    return errorResponse(err)
  }
}
