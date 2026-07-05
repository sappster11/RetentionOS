import { createRecord, getRecordEnriched, queryRecords, EngineError } from '@retentionos/engine'
import type { FilterCondition, SortSpec } from '@retentionos/engine'
import { API_ACTOR, errorResponse, json, readJson, resolveOrgId } from '@/lib/api'

/** Parse a `limit`/`offset` query param: absent -> undefined, present -> finite integer >= 0 or throw. */
function parseNonNegativeInt(raw: string | null, paramName: string): number | undefined {
  if (raw === null) return undefined
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new EngineError(`Query param "${paramName}" must be a non-negative integer.`, 'bad_input')
  }
  return n
}

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

    const limit = parseNonNegativeInt(url.searchParams.get('limit'), 'limit')
    const offset = parseNonNegativeInt(url.searchParams.get('offset'), 'offset')

    const result = await queryRecords(orgId, tableId, {
      filters: filters.length ? filters : undefined,
      sorts: sorts.length ? sorts : undefined,
      limit,
      offset,
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
    const created = await createRecord(orgId, tableId, values, API_ACTOR)
    // Return the enriched shape (values + display) so the UI renders links/computed at once.
    const record = (await getRecordEnriched(orgId, tableId, created.id)) ?? created
    return json({ record }, 201)
  } catch (err) {
    return errorResponse(err)
  }
}
