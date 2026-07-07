import Link from 'next/link'
import { authEnabled } from '@/lib/auth'
import { LoginForm } from './LoginForm'

// The door to the studio is ink, like the site: a full dark plate (brand law — plates
// stay dark in both worlds). data-plate rescopes the tokens so LoginForm's primitives
// render correctly on the dark ground.
export default function LoginPage() {
  return (
    <main
      data-plate
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '4rem 1.5rem',
      }}
    >
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div className="wordmark" style={{ fontSize: 30, marginBottom: 28 }}>
          roam<sup>®</sup>
        </div>
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
