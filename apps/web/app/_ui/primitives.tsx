// Shared light-theme UI primitives. Small, style-object based (matches the repo's existing
// inline-style approach) so no CSS-in-JS dependency is introduced.
import type { CSSProperties, ReactNode } from 'react'

export const inputStyle: CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius)',
  background: 'var(--bg)',
  color: 'var(--text)',
  outline: 'none',
}

export const buttonPrimary: CSSProperties = {
  padding: '6px 12px',
  border: '1px solid var(--accent)',
  borderRadius: 'var(--radius)',
  background: 'var(--accent)',
  color: '#fff',
  fontWeight: 500,
}

export const buttonGhost: CSSProperties = {
  padding: '6px 12px',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius)',
  background: 'var(--bg)',
  color: 'var(--text)',
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>{label}</span>
      {children}
    </label>
  )
}
