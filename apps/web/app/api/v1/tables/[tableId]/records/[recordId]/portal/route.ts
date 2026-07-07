// Enable (or regenerate) the client portal for a Clients record: mints a fresh token,
// stores it in the "Portal token" field (created on first use), returns the token.
// Internal surface (same trust level as the rest of /api/v1).
import { getTable } from '@retentionos/engine'
import { API_ACTOR, errorResponse, json } from '@/lib/api'
import { getCurrentOrg } from '@/lib/org'
import { enablePortal } from '@/lib/portal'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ tableId: string; recordId: string }> },
) {
  try {
    const { tableId, recordId } = await ctx.params
    const org = await getCurrentOrg()
    const table = await getTable(org.id, tableId)
    if (!table || table.slug !== 'clients') {
      return json({ error: { code: 'bad_input', message: 'Portal links are for Clients records.' } }, 400)
    }
    const { token } = await enablePortal(org.id, recordId, API_ACTOR)
    return json({ token })
  } catch (err) {
    return errorResponse(err)
  }
}
