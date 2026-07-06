'use client'

// The form BUILDER — rendered in place of the grid when a 'form' view is active. Left:
// the public URL (with copy), title/description/submitLabel editors, and the field
// checklist (add/remove via checkbox, reorder via up/down, form-level required toggles).
// Right: a live preview rendered by the SAME FormCard as the public page. Every change is
// persisted through the views API via onPatchConfig (write-through, same as grid config).
//
// Mount with key={view.id}: text drafts are local state seeded from the view's config.
import { useMemo, useState } from 'react'
import type { EngineField, EngineView, FormFieldConfig, ViewConfig } from '@retentionos/engine'
import { FormCard } from './FormFields'
import type { FormFieldDef } from './FormFields'
import { isFormWritableType } from './fieldMeta'
import { CopyIcon, FieldIcon } from './icons'

export function FormBuilder({
  fields,
  view,
  onPatchConfig,
}: {
  fields: EngineField[]
  view: EngineView
  onPatchConfig: (patch: Partial<ViewConfig>) => void | Promise<void>
}) {
  const config = view.config
  const formFields: FormFieldConfig[] = useMemo(() => config.fields ?? [], [config.fields])
  const byId = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields])
  const writable = useMemo(() => fields.filter((f) => isFormWritableType(f.type)), [fields])
  const inForm = useMemo(() => new Set(formFields.map((fc) => fc.fieldId)), [formFields])

  // Text drafts commit on blur (write-through on every keystroke would spam PATCHes).
  const [title, setTitle] = useState(config.title ?? '')
  const [description, setDescription] = useState(config.description ?? '')
  const [submitLabel, setSubmitLabel] = useState(config.submitLabel ?? '')
  const [copied, setCopied] = useState(false)

  // Live preview input state — interactive, never submitted.
  const [previewValues, setPreviewValues] = useState<Record<string, unknown>>({})

  const publicUrl =
    typeof window !== 'undefined' && config.publicSlug
      ? `${window.location.origin}/f/${config.publicSlug}`
      : config.publicSlug
        ? `/f/${config.publicSlug}`
        : null

  function setFields(next: FormFieldConfig[]) {
    void onPatchConfig({ fields: next })
  }
  function toggleField(field: EngineField, on: boolean) {
    if (on) setFields([...formFields, { fieldId: field.id, required: field.required }])
    else setFields(formFields.filter((fc) => fc.fieldId !== field.id))
  }
  function move(index: number, delta: -1 | 1) {
    const next = [...formFields]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved!)
    setFields(next)
  }
  function toggleRequired(index: number) {
    setFields(formFields.map((fc, i) => (i === index ? { ...fc, required: !fc.required } : fc)))
  }

  async function copyUrl() {
    if (!publicUrl) return
    try {
      await navigator.clipboard.writeText(publicUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard unavailable (permissions) — the URL is visible/selectable anyway.
    }
  }

  const previewFields: FormFieldDef[] = formFields.flatMap((fc) => {
    const field = byId.get(fc.fieldId)
    if (!field || !isFormWritableType(field.type)) return []
    return [
      {
        id: field.id,
        label: fc.label?.trim() || field.name,
        type: field.type,
        required: fc.required === true,
        ...(fc.helpText ? { helpText: fc.helpText } : {}),
        ...(field.options.choices ? { choices: field.options.choices } : {}),
        ...(field.options.currencySymbol ? { currencySymbol: field.options.currencySymbol } : {}),
      },
    ]
  })

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0, minWidth: 0 }}>
      {/* --- Builder column ---------------------------------------------------- */}
      <div
        style={{
          width: 400,
          flexShrink: 0,
          borderRight: '1px solid var(--border)',
          overflowY: 'auto',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          background: 'var(--bg)',
        }}
      >
        {/* Public URL */}
        <div>
          <div style={sectionLabel}>Public form URL</div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              border: '1px solid var(--border-strong)',
              borderRadius: 6,
              padding: '6px 8px',
              background: 'var(--bg-subtle)',
            }}
          >
            <span
              data-testid="form-public-url"
              style={{
                flex: 1,
                fontSize: 12.5,
                color: 'var(--text-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontFamily: 'ui-monospace, monospace',
              }}
            >
              {publicUrl ?? '—'}
            </span>
            <button onClick={() => void copyUrl()} title="Copy form URL" style={copyBtn}>
              <CopyIcon size={13} />
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--text-faint)' }}>
            Anyone with this link can submit — no sign-in required.
          </p>
        </div>

        {/* Form text */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <div style={sectionLabel}>Title</div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => void onPatchConfig({ title: title.trim() || undefined })}
              placeholder={view.name}
              style={inputStyle}
            />
          </div>
          <div>
            <div style={sectionLabel}>Description</div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => void onPatchConfig({ description: description.trim() || undefined })}
              rows={2}
              placeholder="Optional intro shown under the title"
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>
          <div>
            <div style={sectionLabel}>Submit button label</div>
            <input
              value={submitLabel}
              onChange={(e) => setSubmitLabel(e.target.value)}
              onBlur={() => void onPatchConfig({ submitLabel: submitLabel.trim() || undefined })}
              placeholder="Submit"
              style={inputStyle}
            />
          </div>
        </div>

        {/* Fields on the form, in order */}
        <div>
          <div style={sectionLabel}>Form fields (in order)</div>
          {formFields.length === 0 ? (
            <p style={{ fontSize: 12.5, color: 'var(--text-faint)', margin: '4px 0' }}>
              No fields yet — add some below.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {formFields.map((fc, i) => {
                const field = byId.get(fc.fieldId)
                if (!field) return null
                return (
                  <div
                    key={fc.fieldId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      padding: '6px 8px',
                    }}
                  >
                    <span style={{ color: 'var(--text-faint)', display: 'flex' }}>
                      <FieldIcon type={field.type} size={13} />
                    </span>
                    <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {fc.label?.trim() || field.name}
                    </span>
                    <label
                      title="Required on this form (does not change the field itself)"
                      style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--text-muted)', cursor: 'pointer' }}
                    >
                      <input type="checkbox" checked={fc.required === true} onChange={() => toggleRequired(i)} />
                      Required
                    </label>
                    <button onClick={() => move(i, -1)} disabled={i === 0} title="Move up" style={arrowBtn(i === 0)}>
                      ↑
                    </button>
                    <button
                      onClick={() => move(i, 1)}
                      disabled={i === formFields.length - 1}
                      title="Move down"
                      style={arrowBtn(i === formFields.length - 1)}
                    >
                      ↓
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Add / remove from the table's writable fields */}
        <div>
          <div style={sectionLabel}>Table fields</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {writable.map((f) => (
              <label
                key={f.id}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px', cursor: 'pointer', borderRadius: 4, fontSize: 13 }}
              >
                <input type="checkbox" checked={inForm.has(f.id)} onChange={(e) => toggleField(f, e.target.checked)} />
                <span style={{ color: 'var(--text-faint)', display: 'flex' }}>
                  <FieldIcon type={f.type} size={13} />
                </span>
                <span>{f.name}</span>
              </label>
            ))}
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--text-faint)' }}>
            Computed and linked-record fields can’t be on a public form.
          </p>
        </div>
      </div>

      {/* --- Live preview ------------------------------------------------------- */}
      <div style={{ flex: 1, overflowY: 'auto', background: 'var(--bg-subtle)', padding: '32px 16px' }}>
        <div style={{ maxWidth: 560, margin: '0 auto' }}>
          <div style={{ ...sectionLabel, marginBottom: 10 }}>Live preview</div>
          <FormCard
            title={config.title ?? view.name}
            description={config.description}
            submitLabel={config.submitLabel ?? 'Submit'}
            fields={previewFields}
            values={previewValues}
            errors={{}}
            onChange={(fieldId, raw) => setPreviewValues((v) => ({ ...v, [fieldId]: raw }))}
          />
        </div>
      </div>
    </div>
  )
}

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-faint)',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginBottom: 6,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '7px 9px',
  border: '1px solid var(--border-strong)',
  borderRadius: 6,
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 13,
  outline: 'none',
}

const copyBtn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  border: '1px solid var(--border-strong)',
  borderRadius: 5,
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 12,
  padding: '3px 8px',
  cursor: 'pointer',
  flexShrink: 0,
}

function arrowBtn(disabled: boolean): React.CSSProperties {
  return {
    border: '1px solid var(--border)',
    borderRadius: 4,
    background: 'transparent',
    color: disabled ? 'var(--text-faint)' : 'var(--text-muted)',
    fontSize: 12,
    width: 22,
    height: 22,
    cursor: disabled ? 'default' : 'pointer',
    padding: 0,
  }
}
