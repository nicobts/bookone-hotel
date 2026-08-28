import { z } from 'zod'

/**
 * Worker environment. Parsed once at boot and never read from `process.env`
 * again — a missing variable is a startup failure, not a 3am null deref.
 *
 * Every external endpoint configured here resolves inside the EU (D9). Adding a
 * variable that points at a new service means updating the sub-processor
 * register first.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  WORKER_PORT: z.coerce.number().int().positive().default(8787),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /**
   * Required, with no default. pg-boss would otherwise fail on its first poll
   * — a minute after boot, in a log nobody is reading — instead of here, where
   * the process refuses to start and says why.
   */
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required for the job queue'),

  /**
   * Shared secret guarding `/jobs/*`.
   *
   * Required, with no default, for the same reason as the URL above: a default
   * would be a published password. A minimum length because a two-character
   * secret is an unlocked door with a sign on it.
   */
  WORKER_INTERNAL_TOKEN: z.string().min(24, 'WORKER_INTERNAL_TOKEN must be at least 24 characters'),

  /**
   * Which outbound provider sends guest messages.
   *
   * `log` writes them to the log and transmits nothing — the default until an
   * ESP clears D9 (region pinned, sub-processor register updated, DPA signed).
   * Naming a provider that has not been registered fails at boot, which is the
   * intended outcome: the residency gate is not skippable by setting a variable.
   */
  NOTIFICATION_PROVIDER: z.string().default('log'),
})

export type Env = z.infer<typeof envSchema>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source)

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid worker environment:\n${issues}`)
  }

  return parsed.data
}
