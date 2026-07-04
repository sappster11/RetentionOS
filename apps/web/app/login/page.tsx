import Link from 'next/link'
import { authEnabled } from '@/lib/auth'
import { Card, linkStyle } from '../_components/ui'
import { LoginForm } from './LoginForm'

export default function LoginPage() {
  return (
    <main style={{ maxWidth: 480, margin: '0 auto', padding: '4rem 1.5rem' }}>
      <h1 style={{ fontSize: '1.6rem', marginBottom: '1.5rem' }}>Sign in</h1>
      <Card>
        {authEnabled ? (
          <LoginForm />
        ) : (
          <div>
            <p style={{ opacity: 0.8, marginTop: 0 }}>
              Auth is not configured — running in local dev mode. Set
              NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY to enable sign-in.
            </p>
            <Link href="/clients" style={linkStyle}>
              Continue to Clients →
            </Link>
          </div>
        )}
      </Card>
    </main>
  )
}
