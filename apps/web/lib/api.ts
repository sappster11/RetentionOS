// Shared plumbing for the /api/v1 route handlers. Handlers stay thin: parse → resolve org
// → call @retentionos/engine → JSON. All engine mutations from the REST surface are
// attributed to the {type:'api'} actor (auth integration is out of scope for Phase A; the
// same dev-mode org resolution the app pages use is reused here via getCurrentOrg).
import { NextResponse } from 'next/server'
import { EngineError } from '@retentionos/engine'
import type { Actor } from '@retentionos/engine'
import { getCurrentOrg } from './org'

/** The actor stamped on every mutation coming through the REST API. */
export const API_ACTOR: Actor = { type: 'api' }

export async function resolveOrgId(): Promise<string> {
  const org = await getCurrentOrg()
  return org.id
}

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status })
}

/** Map an EngineError code to an HTTP status; anything else is a 500. */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof EngineError) {
    const status =
      err.code === 'not_found'
        ? 404
        : err.code === 'unknown_field' ||
            err.code === 'bad_value' ||
            err.code === 'bad_input' ||
            err.code === 'bad_type' ||
            err.code === 'bad_options' ||
            err.code === 'bad_filter' ||
            err.code === 'required'
          ? 400
          : 400
    return json({ error: err.message, code: err.code }, status)
  }
  const message = err instanceof Error ? err.message : 'Internal error'
  return json({ error: message }, 500)
}

/** Parse a JSON body, returning {} for an empty/absent body rather than throwing. */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const text = await request.text()
    if (!text) return {}
    const parsed = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    throw new EngineError('Request body is not valid JSON.', 'bad_input')
  }
}
