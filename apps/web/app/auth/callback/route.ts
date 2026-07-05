import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { query } from '@retentionos/db'
import { authEnabled } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// Standard Supabase PKCE code-exchange handler. Only meaningful when auth is enabled —
// with no Supabase project configured this route just bounces to /clients untouched.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (!authEnabled) {
    return NextResponse.redirect(`${origin}/`)
  }

  if (code) {
    try {
      const supabase = await createSupabaseServerClient()
      const { data, error } = await supabase.auth.exchangeCodeForSession(code)
      if (!error && data.user) {
        const { id, email, user_metadata } = data.user
        const fullName =
          typeof user_metadata?.full_name === 'string' ? user_metadata.full_name : null
        await query(
          `insert into public.users (id, email, full_name)
           values ($1, $2, $3)
           on conflict (id) do update
             set email = excluded.email,
                 full_name = coalesce(excluded.full_name, public.users.full_name)`,
          [id, email ?? '', fullName],
        )
      }
    } catch {
      // Fall through to the redirect below — the middleware will send the user back
      // to /login if the session didn't actually get established.
    }
  }

  return NextResponse.redirect(`${origin}/`)
}
