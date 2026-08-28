import type { AuthError } from '@supabase/supabase-js'

/**
 * Maps a Supabase auth error to a translation key.
 *
 * Never surface the provider's own message: it is English-only, it changes
 * between releases, and some variants leak whether an address is registered —
 * which turns the login form into an account-enumeration oracle.
 */
export function authErrorKey(error: AuthError): string {
  switch (error.code) {
    case 'invalid_credentials':
      return 'invalidCredentials'
    case 'email_not_confirmed':
      return 'emailNotConfirmed'
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'rateLimited'
    case 'same_password':
      return 'samePassword'
    case 'weak_password':
      return 'weakPassword'
    case 'otp_expired':
      return 'linkExpired'
    default:
      return 'unknown'
  }
}
