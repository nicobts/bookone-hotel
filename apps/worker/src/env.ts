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
