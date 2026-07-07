'use client'

// Shared FORM rendering — used by BOTH the public /f/[slug] page and the in-app form
// builder's live preview, so the two can never drift apart. Presentational only: state
// (values/errors/submit) lives in the caller. Plain HTML inputs styled to the app's light
// visual language; no dependency on the grid's Cell editors.
import type { FieldType } from '@retentionos/engine'

/** A form field flattened for the client: field def + form-level settings, serializable. */
export interface FormFieldDef {
  id: string
  label: string
  type: FieldType
  required: boolean
  helpText?: string
  choices?: { id: string; name: string; color: string }[]
  currencySymbol?: string
}

/**
 * Build the wire value for one field from its raw input state. Returns undefined for
 * empty (the key is omitted from the submission). Numeric strings are sent as-is — the
 * engine's per-type coercion is the single validator.
 */
export function toWireValue(field: FormFieldDef, raw: unknown): unknown {
  if (raw === undefined || raw === null || raw === '') return undefined
  switch (field.type) {
    case 'checkbox':
      return raw === true ? true : undefined
    case 'multi_select':
      return Array.isArray(raw) && raw.length > 0 ? raw : undefined
    case 'percent':
      // The input collects "50" meaning 50% — suffix it so the engine stores 0.5.
      return `${String(raw)}%`
    case 'attachment':
      // v1: a single URL input, shipped as the engine's [{url}] shape.
      return [{ url: String(raw) }]
    default:
      return raw
  }
}

export function FormCard({
  title,
  description,
  submitLabel,
  fields,
  values,
  errors,
  submitting,
  onChange,
  onSubmit,
}: {
  title: string
  description?: string
  submitLabel: string
  fields: FormFieldDef[]
  values: Record<string, unknown>
  errors: Record<string, string>
  submitting?: boolean
  onChange: (fieldId: string, raw: unknown) => void
  /** Omit to render a non-submitting preview (builder). */
  onSubmit?: () => void
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit?.()
      }}
      noValidate
      style={{
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '28px 28px 24px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
      }}
    >
      <div>
        <h1
          style={{
            fontFamily: 'var(--serif)',
            fontSize: 24,
            fontWeight: 400,
            letterSpacing: '-0.01em',
            margin: 0,
            color: 'var(--text)',
          }}
        >
          {title}
        </h1>
        {description ? (
          <p style={{ margin: '8px 0 0', color: 'var(--text-muted)', fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {description}
          </p>
        ) : null}
      </div>

      {fields.length === 0 ? (
        <p style={{ color: 'var(--text-faint)', fontSize: 13, margin: 0 }}>
          This form has no fields yet.
        </p>
      ) : (
        fields.map((f) => (
          <FormFieldRow
            key={f.id}
            field={f}
            value={values[f.id]}
            error={errors[f.id]}
            onChange={(raw) => onChange(f.id, raw)}
          />
        ))
      )}

      <div>
        <button
          type="submit"
          disabled={submitting || !onSubmit}
          style={{
            padding: '9px 18px',
            border: 'none',
            borderRadius: 6,
            background: 'var(--accent)',
            color: '#fff',
            fontSize: 13.5,
            fontWeight: 550,
            cursor: submitting || !onSubmit ? 'default' : 'pointer',
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting ? 'Submitting…' : submitLabel}
        </button>
      </div>
    </form>
  )
}

function FormFieldRow({
  field,
  value,
  error,
  onChange,
}: {
  field: FormFieldDef
  value: unknown
  error?: string
  onChange: (raw: unknown) => void
}) {
  const isCheckbox = field.type === 'checkbox'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {!isCheckbox ? (
        <label style={labelStyle}>
          {field.label}
          {field.required ? <span style={{ color: 'var(--danger)' }}> *</span> : null}
        </label>
      ) : null}
      {field.helpText && !isCheckbox ? <div style={helpStyle}>{field.helpText}</div> : null}
      <FormInput field={field} value={value} error={!!error} onChange={onChange} />
      {isCheckbox && field.helpText ? <div style={helpStyle}>{field.helpText}</div> : null}
      {error ? (
        <div style={{ color: 'var(--danger)', fontSize: 12.5 }} data-field-error={field.id}>
          {error}
        </div>
      ) : null}
    </div>
  )
}

function FormInput({
  field,
  value,
  error,
  onChange,
}: {
  field: FormFieldDef
  value: unknown
  error: boolean
  onChange: (raw: unknown) => void
}) {
  const base: React.CSSProperties = {
    padding: '8px 10px',
    border: `1px solid ${error ? 'var(--danger)' : 'var(--border-strong)'}`,
    borderRadius: 6,
    background: 'var(--bg)',
    color: 'var(--text)',
    fontSize: 13.5,
    fontFamily: 'inherit',
    outline: 'none',
    width: '100%',
  }
  const str = value == null ? '' : String(value)

  switch (field.type) {
    case 'long_text':
      return (
        <textarea
          value={str}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          style={{ ...base, resize: 'vertical' }}
          data-field-input={field.id}
        />
      )
    case 'checkbox':
      return (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13.5 }}>
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            data-field-input={field.id}
          />
          <span>
            {field.label}
            {field.required ? <span style={{ color: 'var(--danger)' }}> *</span> : null}
          </span>
        </label>
      )
    case 'single_select':
      return (
        <select value={str} onChange={(e) => onChange(e.target.value)} style={base} data-field-input={field.id}>
          <option value="">— select —</option>
          {(field.choices ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )
    case 'multi_select': {
      const selected = Array.isArray(value) ? (value as string[]) : []
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }} data-field-input={field.id}>
          {(field.choices ?? []).map((c) => (
            <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13.5 }}>
              <input
                type="checkbox"
                checked={selected.includes(c.id)}
                onChange={(e) =>
                  onChange(e.target.checked ? [...selected, c.id] : selected.filter((id) => id !== c.id))
                }
              />
              {c.name}
            </label>
          ))}
        </div>
      )
    }
    case 'number':
      return (
        <input type="number" step="any" value={str} onChange={(e) => onChange(e.target.value)} style={base} data-field-input={field.id} />
      )
    case 'currency':
      return (
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)', fontSize: 13.5 }}>
            {field.currencySymbol ?? '$'}
          </span>
          <input
            type="number"
            step="any"
            value={str}
            onChange={(e) => onChange(e.target.value)}
            style={{ ...base, paddingLeft: 24 }}
            data-field-input={field.id}
          />
        </div>
      )
    case 'percent':
      return (
        <div style={{ position: 'relative' }}>
          <input
            type="number"
            step="any"
            value={str}
            onChange={(e) => onChange(e.target.value)}
            style={{ ...base, paddingRight: 26 }}
            data-field-input={field.id}
          />
          <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)', fontSize: 13.5 }}>
            %
          </span>
        </div>
      )
    case 'date':
      return <input type="date" value={str} onChange={(e) => onChange(e.target.value)} style={base} data-field-input={field.id} />
    case 'datetime':
      return (
        <input type="datetime-local" value={str} onChange={(e) => onChange(e.target.value)} style={base} data-field-input={field.id} />
      )
    case 'email':
      return <input type="email" value={str} onChange={(e) => onChange(e.target.value)} style={base} data-field-input={field.id} />
    case 'url':
    case 'attachment':
      return (
        <input
          type="url"
          value={str}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://…"
          style={base}
          data-field-input={field.id}
        />
      )
    default:
      return <input type="text" value={str} onChange={(e) => onChange(e.target.value)} style={base} data-field-input={field.id} />
  }
}

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 550,
  color: 'var(--text)',
}

const helpStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-faint)',
}
