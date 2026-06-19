import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Lazy singletons — only created when first called at runtime, not at build time
let _admin: SupabaseClient | null = null
let _anon:  SupabaseClient | null = null

export function getSupabaseAdmin(): SupabaseClient {
  if (_admin) return _admin
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env vars (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)')
  _admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
  return _admin
}

export function getSupabase(): SupabaseClient {
  if (_anon) return _anon
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Missing Supabase env vars (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)')
  _anon = createClient(url, key)
  return _anon
}

// Keep named exports that existing code imports — they call the lazy getters
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getSupabaseAdmin() as any)[prop]
  }
})

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getSupabase() as any)[prop]
  }
})
