import { deleteField, updateField } from '@retentionos/engine'
import type { FieldOptions } from '@retentionos/engine'
import { errorResponse, json, readJson, resolveOrgId } from '@/lib/api'

type Params = { params: Promise<{ tableId: string; fieldId: string }> }

// PATCH /api/v1/tables/[tableId]/fields/[fieldId] — rename / options / required / position.
export async function PATCH(request: Request, { params }: Params) {
  try {
    const orgId = await resolveOrgId()
    const { tableId, fieldId } = await params
    const body = await readJson(request)
    const field = await updateField(orgId, tableId, fieldId, {
      name: typeof body.name === 'string' ? body.name : undefined,
      options: 'options' in body ? (body.options as FieldOptions) : undefined,
      required: typeof body.required === 'boolean' ? body.required : undefined,
      position: typeof body.position === 'number' ? body.position : undefined,
    })
    return json({ field })
  } catch (err) {
    return errorResponse(err)
  }
}

// DELETE /api/v1/tables/[tableId]/fields/[fieldId]
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const orgId = await resolveOrgId()
    const { tableId, fieldId } = await params
    await deleteField(orgId, tableId, fieldId)
    return json({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
}
