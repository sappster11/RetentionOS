import type { User } from '@supabase/supabase-js'
import { createSupabaseServerClient } from './supabase/server'

/**
 * Auth "lights up" only when Supabase env vars are present. When they are not set (the
 * default in local dev — Postgres with no Supabase project), every auth-aware code path
 * must no-op back to the Phase 0 dev stand-in (default org, no login redirects).
 */
export const authEnabled = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
)

/**
 * Resolves the current authenticated Supabase user from the request's session cookies.
 * Returns null when auth is disabled, when there is no session, or on any error talking
 * to Supabase — callers should treat null as "fall back to dev mode", never throw.
 */
export async function getSessionUser(): Promise<User | null> {
  if (!authEnabled) return null
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    return user ?? null
  } catch {
    return null
  }
}
