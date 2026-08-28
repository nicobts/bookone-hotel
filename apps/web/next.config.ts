import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const nextConfig: NextConfig = {
  // Internal packages ship TypeScript source rather than a build step
  // (docs/03-ARCHITECTURE.md §10) — Next compiles them with the app.
  transpilePackages: ['@bookone/core', '@bookone/i18n'],
  typedRoutes: true,
  // Next 16 blocks dev resources requested from a host it does not consider
  // its own origin, and serves the JS chunks as 403 — the page renders but
  // never hydrates, which looks like a broken form rather than a config issue.
  // 127.0.0.1 and localhost are the same machine and both get used.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
}

export default withNextIntl(nextConfig)
