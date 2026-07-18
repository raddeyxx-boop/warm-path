import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { AuthContext } from './AuthContext'

const PROFILE_COLUMNS = `
  id,
  email,
  full_name,
  role,
  is_active,
  created_at,
  updated_at
`

const PROFILE_TIMEOUT_MS = 15000

async function fetchProfile(userId) {
  const profileRequest = supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .single()

  const timeout = new Promise((_, reject) => {
    window.setTimeout(() => reject(new Error('Profile request timed out.')), PROFILE_TIMEOUT_MS)
  })

  return Promise.race([profileRequest, timeout])
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [isInitializing, setIsInitializing] = useState(true)
  const [isProfileLoading, setIsProfileLoading] = useState(false)
  const [authError, setAuthError] = useState('')
  const profileLoadIdRef = useRef(0)
  const profileRequestRef = useRef({ userId: null, promise: null })
  const userId = session?.user?.id ?? null
  const isLoading = isInitializing || (Boolean(userId) && isProfileLoading)

  const clearAuthState = useCallback(() => {
    profileLoadIdRef.current += 1
    profileRequestRef.current = { userId: null, promise: null }
    setSession(null)
    setProfile(null)
    setIsProfileLoading(false)
  }, [])

  const loadProfileForUser = useCallback(async (nextUserId, options = {}) => {
    const { signOutInactive = true } = options
    if (!supabase || !nextUserId) return null

    if (profileRequestRef.current.userId === nextUserId && profileRequestRef.current.promise) {
      return profileRequestRef.current.promise
    }

    const loadId = ++profileLoadIdRef.current
    const promise = (async () => {
      setIsProfileLoading(true)
      setAuthError('')

      if (import.meta.env.DEV) console.debug('[auth] loading profile', nextUserId)

      const { data, error } = await fetchProfile(nextUserId)
      if (loadId !== profileLoadIdRef.current) return null

      if (error) throw error
      if (!data) throw new Error('Profile row was not found.')

      if (!data.is_active) {
        setProfile(null)
        setAuthError('This account has been disabled.')

        if (signOutInactive) {
          window.setTimeout(() => {
            void supabase.auth.signOut()
          }, 0)
        }

        return data
      }

      setProfile(data)
      if (import.meta.env.DEV) console.debug('[auth] profile loaded', data.id)
      return data
    })()

    profileRequestRef.current = { userId: nextUserId, promise }

    try {
      return await promise
    } catch (error) {
      if (loadId !== profileLoadIdRef.current) return null
      console.error('Profile loading error:', error)
      setProfile(null)
      setAuthError(error instanceof Error ? error.message : 'Unable to load user profile.')
      return null
    } finally {
      if (loadId === profileLoadIdRef.current) {
        setIsProfileLoading(false)
      }
      if (profileRequestRef.current.promise === promise) {
        profileRequestRef.current = { userId: null, promise: null }
      }
    }
  }, [])

  const refreshProfile = useCallback(async () => {
    if (!supabase) return null
    const { data, error } = await supabase.auth.getSession()

    if (error) {
      console.error('Auth refresh error:', error)
      setAuthError(error.message || 'Unable to refresh authentication.')
      clearAuthState()
      return null
    }

    const nextSession = data.session ?? null
    setSession(nextSession)

    if (!nextSession?.user?.id) {
      setProfile(null)
      return null
    }

    return loadProfileForUser(nextSession.user.id)
  }, [clearAuthState, loadProfileForUser])

  useEffect(() => {
    if (!supabase) {
      setAuthError('Supabase is not configured.')
      setIsInitializing(false)
      return undefined
    }

    let mounted = true

    const initializeAuth = async () => {
      try {
        const {
          data: { session: initialSession },
          error,
        } = await supabase.auth.getSession()

        if (error) throw error

        if (mounted) {
          setSession(initialSession ?? null)
        }
      } catch (error) {
        console.error('Auth initialization error:', error)

        if (mounted) {
          setAuthError(error instanceof Error ? error.message : 'Unable to initialize authentication.')
          setSession(null)
        }
      } finally {
        if (mounted) {
          setIsInitializing(false)
        }
      }
    }

    void initializeAuth()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return

      if (import.meta.env.DEV) {
        console.debug('[auth] event', event)
        console.debug('[auth] session user', nextSession?.user?.id)
      }

      setSession(nextSession ?? null)

      if (event === 'SIGNED_OUT') {
        profileLoadIdRef.current += 1
        profileRequestRef.current = { userId: null, promise: null }
        setProfile(null)
        setAuthError('')
        setIsProfileLoading(false)
      }
    })

    return () => {
      mounted = false
      profileLoadIdRef.current += 1
      profileRequestRef.current = { userId: null, promise: null }
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    if (!userId) {
      profileLoadIdRef.current += 1
      setProfile(null)
      setIsProfileLoading(false)
      return undefined
    }

    const loadProfile = async () => {
      const profileData = await loadProfileForUser(userId)
      if (cancelled || profileData?.is_active !== false) return

      setProfile(null)
    }

    void loadProfile()

    return () => {
      cancelled = true
      profileLoadIdRef.current += 1
      profileRequestRef.current = { userId: null, promise: null }
    }
  }, [loadProfileForUser, userId])

  const signIn = useCallback(async (email, password) => {
    if (!supabase) throw new Error('Supabase is not configured.')
    setAuthError('')

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })

    if (error) {
      console.error('Supabase Auth:', error)
      throw new Error(error.message || 'Invalid login credentials.')
    }

    const nextSession = data.session ?? null
    const user = nextSession?.user ?? data.user
    if (!nextSession?.user?.id) {
      throw new Error('Supabase did not return an authenticated session.')
    }

    setSession(nextSession)
    const nextProfile = await loadProfileForUser(nextSession.user.id, { signOutInactive: false })

    if (!nextProfile) throw new Error('Could not load your account profile.')
    if (!nextProfile.is_active) {
      await supabase.auth.signOut()
      throw new Error('This account has been disabled.')
    }

    return { session: nextSession, user, profile: nextProfile }
  }, [loadProfileForUser])

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut()
    clearAuthState()
    setAuthError('')
  }, [clearAuthState])

  const value = useMemo(() => ({
    session,
    user: session?.user || null,
    profile,
    role: profile?.role || null,
    isAdmin: profile?.role === 'admin',
    isAuthenticated: Boolean(session?.user?.id),
    isLoading,
    authError,
    signIn,
    signOut,
    refreshProfile,
  }), [authError, isLoading, profile, refreshProfile, session, signIn, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
