import Link from 'next/link'
import { authEnabled } from '@/lib/auth'
import { LoginForm } from './LoginForm'

export default function LoginPage() {
  return (
    <main style={{ maxWidth: 420, margin: '0 auto', padding: '4rem 1.5rem' }}>
      <h1 style={{ fontSize: 20, marginBottom: 20 }}>Sign in</h1>
      <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 20, background: 'var(--bg)' }}>
        {authEnabled ? (
          <LoginForm />
        ) : (
          <div>
            <p style={{ color: 'var(--text-muted)', marginTop: 0, lineHeight: 1.6 }}>
              Auth is not configured — running in local dev mode. Set
              NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY to enable sign-in.
            </p>
            <Link href="/" style={{ color: 'var(--accent)' }}>
              Continue to workspace →
            </Link>
          </div>
        )}
      </div>
    </main>
  )
}
