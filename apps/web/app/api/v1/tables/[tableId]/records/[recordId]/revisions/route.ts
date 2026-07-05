import { listRecordRevisions } from '@retentionos/engine'
import { errorResponse, json, resolveOrgId } from '@/lib/api'

type Params = { params: Promise<{ tableId: string; recordId: string }> }

// GET /api/v1/tables/[tableId]/records/[recordId]/revisions
// The record's audit trail (newest first), for the detail panel's history section.
export async function GET(_request: Request, { params }: Params) {
  try {
    const orgId = await resolveOrgId()
    const { recordId } = await params
    const revisions = await listRecordRevisions(orgId, recordId)
    return json({ revisions })
  } catch (err) {
    return errorResponse(err)
  }
}
