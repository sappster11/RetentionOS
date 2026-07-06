import { deleteBase, getBase, updateBase } from '@retentionos/engine'
import { EngineError } from '@retentionos/engine'
import { errorResponse, json, readJson, resolveOrgId } from '@/lib/api'

type Params = { params: Promise<{ baseId: string }> }

// GET /api/v1/bases/[baseId]
export async function GET(_request: Request, { params }: Params) {
  try {
    const orgId = await resolveOrgId()
    const { baseId } = await params
    const base = await getBase(orgId, baseId)
    if (!base) throw new EngineError('Base not found.', 'not_found')
    return json({ base })
  } catch (err) {
    return errorResponse(err)
  }
}

// PATCH /api/v1/bases/[baseId] — update name/icon/position.
export async function PATCH(request: Request, { params }: Params) {
  try {
    const orgId = await resolveOrgId()
    const { baseId } = await params
    const body = await readJson(request)
    const base = await updateBase(orgId, baseId, {
      name: typeof body.name === 'string' ? body.name : undefined,
      icon: 'icon' in body ? (body.icon as string | null) : undefined,
      position: typeof body.position === 'number' ? body.position : undefined,
    })
    return json({ base })
  } catch (err) {
    return errorResponse(err)
  }
}

// DELETE /api/v1/bases/[baseId] — only when the base contains no tables (400 otherwise).
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const orgId = await resolveOrgId()
    const { baseId } = await params
    await deleteBase(orgId, baseId)
    return json({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
}
