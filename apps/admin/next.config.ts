import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

/** The repo-root `.env`, as in `apps/web` — deployed environments supply real variables. */
const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url))
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv)

/**
 * The operator console (ADR-030, ADR-031).
 *
 * `output: 'standalone'` because it ships as its own container, reachable only
 * over Tailscale — never on Vercel beside the tenant app. No i18n: operators
 * work in English; the guest and hotel surfaces are where languages matter.
 */
const nextConfig: NextConfig = {
  output: 'standalone',
  // The monorepo root, so the standalone trace includes workspace packages.
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  transpilePackages: [
    '@bookone/core',
    '@bookone/agents',
    '@bookone/i18n',
    '@bookone/ui',
    '@bookone/telemetry',
  ],
  // The OpenTelemetry SDK and pino stay Node modules rather than bundled
  // (ADR-036): both load optional pieces at runtime that a bundle would miss.
  serverExternalPackages: ['@opentelemetry/sdk-node', 'pino'],
  typedRoutes: true,
  poweredByHeader: false,
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ]
  },
}

export default nextConfig
