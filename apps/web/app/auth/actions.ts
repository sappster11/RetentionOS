'use server'

import { redirect } from 'next/navigation'
import { authEnabled } from '@/lib/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export async function signOutAction(): Promise<void> {
  if (authEnabled) {
    const supabase = await createSupabaseServerClient()
    await supabase.auth.signOut()
  }
  redirect('/login')
}
