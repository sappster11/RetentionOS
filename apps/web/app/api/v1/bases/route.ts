import { createBase, listBases } from '@retentionos/engine'
import { API_ACTOR, errorResponse, json, readJson, resolveOrgId } from '@/lib/api'

// GET /api/v1/bases — list all bases in the org.
export async function GET() {
  try {
    const orgId = await resolveOrgId()
    const bases = await listBases(orgId)
    return json({ bases })
  } catch (err) {
    return errorResponse(err)
  }
}

// POST /api/v1/bases — create a base. Body: { name, icon?, slug? }
export async function POST(request: Request) {
  try {
    const orgId = await resolveOrgId()
    const body = await readJson(request)
    const base = await createBase(
      orgId,
      {
        name: String(body.name ?? ''),
        slug: typeof body.slug === 'string' ? body.slug : undefined,
        icon: typeof body.icon === 'string' ? body.icon : null,
      },
      API_ACTOR,
    )
    return json({ base }, 201)
  } catch (err) {
    return errorResponse(err)
  }
}
