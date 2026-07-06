// Public form submit route — error hygiene. The public surface must pass engine errors
// through (message + fieldErrors, as today) but reduce ANY unexpected exception to a
// fixed generic 500 body, with the real error only logged server-side. submitForm is
// mocked so each path can be scripted without a database.
import { afterEach, describe, expect, it, vi } from 'vitest'

const { submitFormMock } = vi.hoisted(() => ({ submitFormMock: vi.fn() }))

vi.mock('@retentionos/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@retentionos/engine')>()
  return { ...actual, submitForm: submitFormMock }
})

import { EngineError, FormSubmissionError } from '@retentionos/engine'
import { POST } from '../app/api/forms/[slug]/submit/route'

function post(body: unknown) {
  const request = new Request('http://localhost/api/forms/test-slug/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(request, { params: Promise.resolve({ slug: 'test-slug' }) })
}

afterEach(() => {
  vi.restoreAllMocks()
  submitFormMock.mockReset()
})

describe('POST /api/forms/[slug]/submit — public error hygiene', () => {
  it('an unexpected raw Error returns the generic 500 body and logs the real error', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    submitFormMock.mockRejectedValue(new Error('pg: connection refused at 10.0.0.7:5432'))

    const res = await post({ values: {} })
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ error: { code: 'internal', message: 'Something went wrong.' } })
    // The internal message never reaches the anonymous caller…
    expect(JSON.stringify(body)).not.toContain('connection refused')
    // …but it IS logged server-side (the real Error object, message intact).
    expect(logged).toHaveBeenCalled()
    const loggedErr = logged.mock.calls[0]![1] as Error
    expect(loggedErr).toBeInstanceOf(Error)
    expect(loggedErr.message).toContain('connection refused')
  })

  it('FormSubmissionError still passes through with fieldErrors (400)', async () => {
    submitFormMock.mockRejectedValue(
      new FormSubmissionError('Some answers need attention.', { 'field-1': 'Email is required.' }),
    )
    const res = await post({ values: {} })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'Some answers need attention.',
      code: 'form_validation',
      fieldErrors: { 'field-1': 'Email is required.' },
    })
  })

  it('EngineError codes still pass through (not_found → 404)', async () => {
    submitFormMock.mockRejectedValue(new EngineError('Form not found.', 'not_found'))
    const res = await post({ values: {} })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Form not found.', code: 'not_found' })
  })

  it('a successful submission still returns 201 {ok, recordId}', async () => {
    submitFormMock.mockResolvedValue({ record: { id: 'rec-1' }, form: {} })
    const res = await post({ values: { f: 'v' } })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ ok: true, recordId: 'rec-1' })
  })
})
