import { createField, listFields } from '@retentionos/engine'
import type { FieldOptions, FieldType } from '@retentionos/engine'
import { API_ACTOR, errorResponse, json, readJson, resolveOrgId } from '@/lib/api'

type Params = { params: Promise<{ tableId: string }> }

// GET /api/v1/tables/[tableId]/fields
export async function GET(_request: Request, { params }: Params) {
  try {
    const orgId = await resolveOrgId()
    const { tableId } = await params
    const fields = await listFields(orgId, tableId)
    return json({ fields })
  } catch (err) {
    return errorResponse(err)
  }
}

// POST /api/v1/tables/[tableId]/fields — body: { name, type, options?, required?, position? }
export async function POST(request: Request, { params }: Params) {
  try {
    const orgId = await resolveOrgId()
    const { tableId } = await params
    const body = await readJson(request)
    const field = await createField(
      orgId,
      tableId,
      {
        name: String(body.name ?? ''),
        type: body.type as FieldType,
        options: (body.options as FieldOptions | undefined) ?? undefined,
        required: typeof body.required === 'boolean' ? body.required : undefined,
        position: typeof body.position === 'number' ? body.position : undefined,
      },
      API_ACTOR,
    )
    return json({ field }, 201)
  } catch (err) {
    return errorResponse(err)
  }
}
