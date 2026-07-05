'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { Field, buttonPrimary, inputStyle } from '../_ui/primitives'

export function LoginForm() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus('sending')
    setError(null)
    try {
      const supabase = createSupabaseBrowserClient()
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      })
      if (otpError) throw otpError
      setStatus('sent')
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Failed to send magic link.')
    }
  }

  if (status === 'sent') {
    return (
      <p style={{ opacity: 0.8 }}>
        Check your email — we sent a magic link to <strong>{email}</strong>.
      </p>
    )
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: 320 }}>
      <Field label="Email">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@agency.com"
          style={inputStyle}
        />
      </Field>
      <button type="submit" disabled={status === 'sending'} style={buttonPrimary}>
        {status === 'sending' ? 'Sending…' : 'Send magic link'}
      </button>
      {error ? <p style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</p> : null}
    </form>
  )
}
