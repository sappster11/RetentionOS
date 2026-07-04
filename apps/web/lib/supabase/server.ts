// Server-side Supabase client (uses the anon key + the user's session cookies, so RLS
// applies as that user). Import from Server Components, Route Handlers, and Server Actions.
import { createServerClient } from '@supabase/ssr'
import type { CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'

type CookieToSet = { name: string; value: string; options: CookieOptions }

export async function createSupabaseServerClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: CookieToSet[]) {
          // In a Server Component render the cookie store is read-only; the middleware
          // (added with the Phase 0.3 auth task) refreshes the session instead.
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // ignore — called from a context where setting cookies isn't allowed
          }
        },
      },
    },
  )
}
