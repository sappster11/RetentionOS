import { deleteTable, describeTable, updateTable } from '@retentionos/engine'
import { errorResponse, json, readJson, resolveOrgId } from '@/lib/api'

type Params = { params: Promise<{ tableId: string }> }

// GET /api/v1/tables/[tableId] — full descriptor: table + fields + views.
export async function GET(_request: Request, { params }: Params) {
  try {
    const orgId = await resolveOrgId()
    const { tableId } = await params
    const descriptor = await describeTable(orgId, tableId)
    return json(descriptor)
  } catch (err) {
    return errorResponse(err)
  }
}

// PATCH /api/v1/tables/[tableId] — update name/icon/description/baseId/position.
// baseId moves the table into a base (uuid) or ungroups it (null).
export async function PATCH(request: Request, { params }: Params) {
  try {
    const orgId = await resolveOrgId()
    const { tableId } = await params
    const body = await readJson(request)
    const table = await updateTable(orgId, tableId, {
      name: typeof body.name === 'string' ? body.name : undefined,
      icon: 'icon' in body ? (body.icon as string | null) : undefined,
      description: 'description' in body ? (body.description as string | null) : undefined,
      baseId: 'baseId' in body ? (body.baseId as string | null) : undefined,
      position: typeof body.position === 'number' ? body.position : undefined,
    })
    return json({ table })
  } catch (err) {
    return errorResponse(err)
  }
}

// DELETE /api/v1/tables/[tableId]
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const orgId = await resolveOrgId()
    const { tableId } = await params
    await deleteTable(orgId, tableId)
    return json({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
}
