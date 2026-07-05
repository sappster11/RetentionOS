import { deleteRecords } from '@retentionos/engine'
import { API_ACTOR, errorResponse, json, readJson, resolveOrgId } from '@/lib/api'

type Params = { params: Promise<{ tableId: string }> }

// POST /api/v1/tables/[tableId]/records/bulk-delete — body: { recordIds: string[] }
export async function POST(request: Request, { params }: Params) {
  try {
    const orgId = await resolveOrgId()
    const { tableId } = await params
    const body = await readJson(request)
    const recordIds = Array.isArray(body.recordIds) ? (body.recordIds as string[]) : []
    const result = await deleteRecords(orgId, tableId, recordIds, API_ACTOR)
    return json(result)
  } catch (err) {
    return errorResponse(err)
  }
}
