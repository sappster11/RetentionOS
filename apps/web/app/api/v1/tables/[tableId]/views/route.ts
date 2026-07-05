import { createView, listViews } from '@retentionos/engine'
import type { ViewConfig, ViewType } from '@retentionos/engine'
import { errorResponse, json, readJson, resolveOrgId } from '@/lib/api'

type Params = { params: Promise<{ tableId: string }> }

// GET /api/v1/tables/[tableId]/views
export async function GET(_request: Request, { params }: Params) {
  try {
    const orgId = await resolveOrgId()
    const { tableId } = await params
    const views = await listViews(orgId, tableId)
    return json({ views })
  } catch (err) {
    return errorResponse(err)
  }
}

// POST /api/v1/tables/[tableId]/views — body: { name, type?, config? }
export async function POST(request: Request, { params }: Params) {
  try {
    const orgId = await resolveOrgId()
    const { tableId } = await params
    const body = await readJson(request)
    const view = await createView(orgId, tableId, {
      name: String(body.name ?? ''),
      type: (body.type as ViewType | undefined) ?? undefined,
      config: (body.config as ViewConfig | undefined) ?? undefined,
    })
    return json({ view }, 201)
  } catch (err) {
    return errorResponse(err)
  }
}
