// Public portal action endpoint: approve a draft or request changes. Same trust model
// and error hygiene as the public form-submit route (capability token, generic 500s).
import { getCurrentOrg } from '@/lib/org'
import { json, publicErrorResponse, readJson } from '@/lib/api'
import { portalAction } from '@/lib/portal'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params
    const body = (await readJson(req)) as {
      draftId?: unknown
      action?: unknown
      comment?: unknown
    }
    const draftId = typeof body.draftId === 'string' ? body.draftId : ''
    const action = body.action === 'approve' || body.action === 'request_changes' ? body.action : null
    if (!draftId || !action) {
      return json({ error: { code: 'bad_input', message: 'draftId and action are required.' } }, 400)
    }
    const comment = typeof body.comment === 'string' ? body.comment : undefined
    const org = await getCurrentOrg()
    const result = await portalAction(org.id, token, draftId, action, comment)
    if (!result) {
      return json({ error: { code: 'not_found', message: 'Not available.' } }, 404)
    }
    return json({ ok: true })
  } catch (err) {
    return publicErrorResponse(err)
  }
}
