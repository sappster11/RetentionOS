import { convertLead, getTable } from '@retentionos/engine'
import { API_ACTOR, errorResponse, json, resolveOrgId } from '@/lib/api'

type Params = { params: Promise<{ tableId: string; recordId: string }> }

// POST /api/v1/tables/[tableId]/records/[recordId]/convert — Lead → Client conversion.
// Thin: the behavior (validation, mapping, idempotency) lives in engine convertLead; the
// route only checks the URL actually addresses the Leads table before delegating.
export async function POST(_request: Request, { params }: Params) {
  try {
    const orgId = await resolveOrgId()
    const { tableId, recordId } = await params
    const table = await getTable(orgId, tableId)
    if (!table) return json({ error: 'Table not found.', code: 'not_found' }, 404)
    if (table.slug !== 'leads') {
      return json(
        { error: 'Convert to client is only available on the Leads table.', code: 'bad_input' },
        400,
      )
    }
    const result = await convertLead(orgId, recordId, API_ACTOR)
    return json({ result })
  } catch (err) {
    return errorResponse(err)
  }
}
