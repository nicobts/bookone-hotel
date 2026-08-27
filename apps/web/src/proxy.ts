import createMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'

export default createMiddleware(routing)

export const config = {
  // Everything except Next internals, the API surface and files with an
  // extension. Keep this in sync when a new top-level non-localized path lands.
  matcher: ['/((?!api|_next|_vercel|.*[.].*).*)'],
}
