import { getRecord, listRecordRevisions } from '@retentionos/engine'
import { errorResponse, json, resolveOrgId } from '@/lib/api'

type Params = { params: Promise<{ tableId: string; recordId: string }> }

// GET /api/v1/tables/[tableId]/records/[recordId]/revisions
// The record's audit trail (newest first), for the detail panel's history section.
export async function GET(_request: Request, { params }: Params) {
  try {
    const orgId = await resolveOrgId()
    const { tableId, recordId } = await params
    // 404 if the record doesn't belong to THIS table (path is scoped to a table; don't leak
    // another table's revisions through a mismatched tableId).
    const record = await getRecord(orgId, tableId, recordId)
    if (!record) return json({ error: 'Record not found.', code: 'not_found' }, 404)
    const revisions = await listRecordRevisions(orgId, recordId)
    return json({ revisions })
  } catch (err) {
    return errorResponse(err)
  }
}
