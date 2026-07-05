import { createTable, listTables } from '@retentionos/engine'
import { API_ACTOR, errorResponse, json, readJson, resolveOrgId } from '@/lib/api'

// GET /api/v1/tables — list all tables in the org.
export async function GET() {
  try {
    const orgId = await resolveOrgId()
    const tables = await listTables(orgId)
    return json({ tables })
  } catch (err) {
    return errorResponse(err)
  }
}

// POST /api/v1/tables — create a table. Body: { name, icon?, description?, slug? }
export async function POST(request: Request) {
  try {
    const orgId = await resolveOrgId()
    const body = await readJson(request)
    const table = await createTable(
      orgId,
      {
        name: String(body.name ?? ''),
        slug: typeof body.slug === 'string' ? body.slug : undefined,
        icon: typeof body.icon === 'string' ? body.icon : null,
        description: typeof body.description === 'string' ? body.description : null,
      },
      API_ACTOR,
    )
    return json({ table }, 201)
  } catch (err) {
    return errorResponse(err)
  }
}
