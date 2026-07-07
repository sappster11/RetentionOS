import { createConversation, listConversations } from '@retentionos/engine'
import { errorResponse, json, readJson, resolveOrgId } from '@/lib/api'

// GET /api/v1/conversations — recent agent conversations, most recently touched first.
// Query: ?limit=N (default 50, max 200).
export async function GET(request: Request) {
  try {
    const orgId = await resolveOrgId()
    const url = new URL(request.url)
    const rawLimit = url.searchParams.get('limit')
    const limit = rawLimit === null ? undefined : Number(rawLimit)
    const conversations = await listConversations(orgId, { limit })
    return json({ conversations })
  } catch (err) {
    return errorResponse(err)
  }
}

// POST /api/v1/conversations — create an (optionally titled) conversation. Body: { title? }
// Usually unnecessary: the chat route auto-creates one when conversationId is absent.
export async function POST(request: Request) {
  try {
    const orgId = await resolveOrgId()
    const body = await readJson(request)
    const conversation = await createConversation(orgId, {
      title: typeof body.title === 'string' ? body.title : null,
    })
    return json({ conversation }, 201)
  } catch (err) {
    return errorResponse(err)
  }
}
