import { supabase } from '../lib/supabase'

export async function requireSupabaseSession() {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  const {
    data: { session },
    error,
  } = await supabase.auth.getSession()

  if (error) {
    throw new Error(error.message || 'Unable to verify your session.')
  }

  if (!session?.user?.id) {
    throw new Error('Your session has expired. Please sign in again.')
  }

  if (!session.access_token) {
    throw new Error('Your authenticated session has no access token. Please sign in again.')
  }

  return session
}
