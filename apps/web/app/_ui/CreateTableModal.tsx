'use client'

import { useState } from 'react'
import { Field, buttonGhost, buttonPrimary, inputStyle } from './primitives'

export function CreateTableModal({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (input: { name: string; icon?: string; description?: string }) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    try {
      await onCreate({
        name: name.trim(),
        icon: icon.trim() || undefined,
        description: description.trim() || undefined,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create table.')
      setBusy(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.28)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420,
          background: 'var(--bg)',
          borderRadius: 8,
          border: '1px solid var(--border)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
          padding: 20,
        }}
      >
        <h2 style={{ margin: '0 0 16px', fontSize: 16 }}>New table</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Name">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="Clients"
              style={inputStyle}
            />
          </Field>
          <Field label="Icon (emoji, optional)">
            <input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="👥" style={inputStyle} />
          </Field>
          <Field label="Description (optional)">
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Client accounts and their status"
              style={inputStyle}
            />
          </Field>
          {error ? <p style={{ color: 'var(--danger)', fontSize: 12, margin: 0 }}>{error}</p> : null}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button onClick={onClose} style={buttonGhost}>
              Cancel
            </button>
            <button onClick={submit} disabled={busy || !name.trim()} style={buttonPrimary}>
              {busy ? 'Creating…' : 'Create table'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
