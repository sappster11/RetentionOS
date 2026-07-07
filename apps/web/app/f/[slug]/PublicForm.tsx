'use client'

// The interactive half of the public form page: input state, submit to
// POST /api/forms/[slug]/submit, inline per-field errors (server-side required/coercion
// validation via the engine), and the "Response recorded" success state.
import { useState } from 'react'
import { FormCard, toWireValue } from '@/app/_ui/FormFields'
import type { FormFieldDef } from '@/app/_ui/FormFields'

export function PublicForm({
  slug,
  title,
  description,
  submitLabel,
  fields,
}: {
  slug: string
  title: string
  description?: string
  submitLabel: string
  fields: FormFieldDef[]
}) {
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function submit() {
    setSubmitting(true)
    setFormError(null)
    setFieldErrors({})
    try {
      const wire: Record<string, unknown> = {}
      for (const f of fields) {
        const v = toWireValue(f, values[f.id])
        if (v !== undefined) wire[f.id] = v
      }
      const res = await fetch(`/api/forms/${encodeURIComponent(slug)}/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ values: wire }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        fieldErrors?: Record<string, string>
      }
      if (!res.ok) {
        setFieldErrors(data.fieldErrors ?? {})
        setFormError(
          data.fieldErrors && Object.keys(data.fieldErrors).length > 0
            ? null // per-field messages are enough; no duplicate banner
            : (data.error ?? `Submission failed (${res.status}).`),
        )
        return
      }
      setDone(true)
      setValues({})
    } catch {
      setFormError('Submission failed — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--bg-subtle)',
        display: 'flex',
        justifyContent: 'center',
        padding: '48px 16px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 560 }}>
        {done ? (
          <div
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: '40px 28px',
              textAlign: 'center',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 12, color: 'var(--moss-text)' }} aria-hidden>
              ✓
            </div>
            <h1
              style={{
                fontFamily: 'var(--serif)',
                fontSize: 21,
                fontWeight: 400,
                margin: 0,
                color: 'var(--text)',
              }}
            >
              Response recorded
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 13.5, margin: '8px 0 20px' }}>
              Thanks — your response has been submitted.
            </p>
            <button
              onClick={() => setDone(false)}
              style={{
                padding: '8px 16px',
                border: '1px solid var(--border-strong)',
                borderRadius: 6,
                background: 'var(--bg)',
                color: 'var(--text)',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Submit another response
            </button>
          </div>
        ) : (
          <>
            {formError ? (
              <div
                style={{
                  marginBottom: 12,
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: '1px solid var(--danger)',
                  color: 'var(--danger)',
                  background: 'var(--bg)',
                  fontSize: 13,
                }}
              >
                {formError}
              </div>
            ) : null}
            <FormCard
              title={title}
              description={description}
              submitLabel={submitLabel}
              fields={fields}
              values={values}
              errors={fieldErrors}
              submitting={submitting}
              onChange={(fieldId, raw) => setValues((v) => ({ ...v, [fieldId]: raw }))}
              onSubmit={() => void submit()}
            />
          </>
        )}
        <div style={{ marginTop: 22, textAlign: 'center', fontSize: 11.5, color: 'var(--text-faint)' }}>
          Powered by{' '}
          <span className="wordmark" style={{ fontSize: 13, color: 'var(--text-muted)' }}>roam</span>
        </div>
      </div>
    </main>
  )
}
