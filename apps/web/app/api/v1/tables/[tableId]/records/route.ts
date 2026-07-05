import { createRecord, queryRecords } from '@retentionos/engine'
import type { FilterCondition, SortSpec } from '@retentionos/engine'
import { API_ACTOR, errorResponse, json, readJson, resolveOrgId } from '@/lib/api'

type Params = { params: Promise<{ tableId: string }> }

/**
 * GET /api/v1/tables/[tableId]/records
 *   ?limit=&offset=
 *   &sort=<fieldId>:asc|desc  (repeatable)
 *   &filter=<fieldId>:<op>:<value>  (repeatable; op is_empty/is_not_empty take no value)
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const orgId = await resolveOrgId()
    const { tableId } = await params
    const url = new URL(request.url)

    const sorts: SortSpec[] = url.searchParams.getAll('sort').map((s) => {
      const [fieldId, direction] = s.split(':')
      return { fieldId: fieldId ?? '', direction: direction === 'desc' ? 'desc' : 'asc' }
    })

    const filters: FilterCondition[] = url.searchParams.getAll('filter').map((f) => {
      const [fieldId, op, ...rest] = f.split(':')
      return {
        fieldId: fieldId ?? '',
        op: (op ?? 'eq') as FilterCondition['op'],
        value: rest.length ? rest.join(':') : undefined,
      }
    })

    const limitRaw = url.searchParams.get('limit')
    const offsetRaw = url.searchParams.get('offset')

    const result = await queryRecords(orgId, tableId, {
      filters: filters.length ? filters : undefined,
      sorts: sorts.length ? sorts : undefined,
      limit: limitRaw ? Number(limitRaw) : undefined,
      offset: offsetRaw ? Number(offsetRaw) : undefined,
    })
    return json(result)
  } catch (err) {
    return errorResponse(err)
  }
}

// POST /api/v1/tables/[tableId]/records — body: { values: { <fieldId>: value } }
export async function POST(request: Request, { params }: Params) {
  try {
    const orgId = await resolveOrgId()
    const { tableId } = await params
    const body = await readJson(request)
    const values = (body.values as Record<string, unknown>) ?? {}
    const record = await createRecord(orgId, tableId, values, API_ACTOR)
    return json({ record }, 201)
  } catch (err) {
    return errorResponse(err)
  }
}
