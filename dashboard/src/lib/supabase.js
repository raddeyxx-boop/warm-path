import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export function getConfigError() {
  if (!supabaseUrl || !supabaseAnonKey) {
    return 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Add them to dashboard/.env and restart the dev server.'
  }

  if (!/^https:\/\/.+\.supabase\.co$/i.test(supabaseUrl)) {
    return 'VITE_SUPABASE_URL must be a valid Supabase project URL.'
  }

  return ''
}

export const supabase = getConfigError()
  ? null
  : createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })

export function getConnectionState() {
  return {
    configured: Boolean(supabase),
    url: supabaseUrl || '',
    error: getConfigError(),
  }
}
