import { FormSubmissionError, submitForm } from '@retentionos/engine'
import { errorResponse, json, readJson } from '@/lib/api'

// POST /api/forms/[slug]/submit — the PUBLIC form submission endpoint (no auth, no org
// resolution: the slug alone identifies the form and its org). Body: { values: { <fieldId>:
// value } }. The engine validates form-level required-ness + per-type coercion and creates
// the record with actor {type:'api', id:'form:<slug>'}. Validation problems come back as
// 400 { error, code:'form_validation', fieldErrors } for inline rendering.
type Params = { params: Promise<{ slug: string }> }

export async function POST(request: Request, { params }: Params) {
  try {
    const { slug } = await params
    const body = await readJson(request)
    const values =
      typeof body.values === 'object' && body.values !== null && !Array.isArray(body.values)
        ? (body.values as Record<string, unknown>)
        : {}
    const { record } = await submitForm(slug, values)
    return json({ ok: true, recordId: record.id }, 201)
  } catch (err) {
    if (err instanceof FormSubmissionError) {
      return json({ error: err.message, code: err.code, fieldErrors: err.fieldErrors }, 400)
    }
    return errorResponse(err)
  }
}
