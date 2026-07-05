import { deleteRecords, getRecord, updateRecord } from '@retentionos/engine'
import { API_ACTOR, errorResponse, json, readJson, resolveOrgId } from '@/lib/api'

type Params = { params: Promise<{ tableId: string; recordId: string }> }

// GET /api/v1/tables/[tableId]/records/[recordId]
export async function GET(_request: Request, { params }: Params) {
  try {
    const orgId = await resolveOrgId()
    const { tableId, recordId } = await params
    const record = await getRecord(orgId, tableId, recordId)
    if (!record) return json({ error: 'Record not found.', code: 'not_found' }, 404)
    return json({ record })
  } catch (err) {
    return errorResponse(err)
  }
}

// PATCH /api/v1/tables/[tableId]/records/[recordId] — body: { values: { <fieldId>: value } }
export async function PATCH(request: Request, { params }: Params) {
  try {
    const orgId = await resolveOrgId()
    const { tableId, recordId } = await params
    const body = await readJson(request)
    const values = (body.values as Record<string, unknown>) ?? {}
    const record = await updateRecord(orgId, tableId, recordId, values, API_ACTOR)
    return json({ record })
  } catch (err) {
    return errorResponse(err)
  }
}

// DELETE /api/v1/tables/[tableId]/records/[recordId]
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const orgId = await resolveOrgId()
    const { tableId, recordId } = await params
    const { deleted } = await deleteRecords(orgId, tableId, [recordId], API_ACTOR)
    return json({ deleted })
  } catch (err) {
    return errorResponse(err)
  }
}
