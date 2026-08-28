/**
 * Supabase configuration, read once.
 *
 * `isConfigured` exists so the app runs before a project is provisioned:
 * the proxy skips session handling and the auth forms say so, rather than
 * crashing on a blank URL. Once .env is filled in, that branch is never taken.
 */
export const supabaseEnv = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
} as const

export function isSupabaseConfigured(): boolean {
  return supabaseEnv.url.length > 0 && supabaseEnv.anonKey.length > 0
}
