import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

/**
 * The repo-root `.env`.
 *
 * Next reads `.env` files beside the app, and the platform's configuration
 * lives one level up because the worker, the migrations and the seed script
 * share it — one set of credentials, one file, per `.env.example`.
 *
 * Loaded here because this file runs in the server process before the app
 * boots. Without it the app starts perfectly and then fails at the first
 * outbound call, with an error that names neither the variable nor the file.
 * Deployed environments supply real environment variables and have no file
 * here, which is why a missing one is silent. Nothing already set is
 * overwritten.
 */
const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url))
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv)

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
