import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const nextConfig: NextConfig = {
  // Internal packages ship TypeScript source rather than a build step
  // (docs/03-ARCHITECTURE.md §10) — Next compiles them with the app.
  transpilePackages: ['@bookone/core', '@bookone/i18n'],
  typedRoutes: true,
}

export default withNextIntl(nextConfig)
