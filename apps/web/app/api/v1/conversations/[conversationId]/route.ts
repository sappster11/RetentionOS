import { deleteConversation, getConversation } from '@retentionos/engine'
import { errorResponse, json, resolveOrgId } from '@/lib/api'

type Params = { params: Promise<{ conversationId: string }> }

// GET /api/v1/conversations/[conversationId] — the conversation + full transcript
// (messages oldest-first, content in the chat panel's parts shape).
export async function GET(_request: Request, { params }: Params) {
  try {
    const orgId = await resolveOrgId()
    const { conversationId } = await params
    const { conversation, messages } = await getConversation(orgId, conversationId)
    return json({ conversation, messages })
  } catch (err) {
    return errorResponse(err)
  }
}

// DELETE /api/v1/conversations/[conversationId] — delete the thread (messages cascade).
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const orgId = await resolveOrgId()
    const { conversationId } = await params
    await deleteConversation(orgId, conversationId)
    return json({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
}
