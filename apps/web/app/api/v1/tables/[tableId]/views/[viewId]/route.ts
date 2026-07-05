import { deleteView, getView, updateView } from '@retentionos/engine'
import type { ViewConfig, ViewType } from '@retentionos/engine'
import { errorResponse, json, readJson, resolveOrgId } from '@/lib/api'

type Params = { params: Promise<{ tableId: string; viewId: string }> }

// GET /api/v1/tables/[tableId]/views/[viewId]
export async function GET(_request: Request, { params }: Params) {
  try {
    const orgId = await resolveOrgId()
    const { tableId, viewId } = await params
    const view = await getView(orgId, tableId, viewId)
    if (!view) return json({ error: 'View not found.', code: 'not_found' }, 404)
    return json({ view })
  } catch (err) {
    return errorResponse(err)
  }
}

// PATCH /api/v1/tables/[tableId]/views/[viewId]
export async function PATCH(request: Request, { params }: Params) {
  try {
    const orgId = await resolveOrgId()
    const { tableId, viewId } = await params
    const body = await readJson(request)
    const view = await updateView(orgId, tableId, viewId, {
      name: typeof body.name === 'string' ? body.name : undefined,
      type: (body.type as ViewType | undefined) ?? undefined,
      config: 'config' in body ? (body.config as ViewConfig) : undefined,
      position: typeof body.position === 'number' ? body.position : undefined,
    })
    return json({ view })
  } catch (err) {
    return errorResponse(err)
  }
}

// DELETE /api/v1/tables/[tableId]/views/[viewId]
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const orgId = await resolveOrgId()
    const { tableId, viewId } = await params
    await deleteView(orgId, tableId, viewId)
    return json({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
}
