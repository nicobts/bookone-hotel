import { z } from 'zod'

/**
 * Worker environment. Parsed once at boot and never read from `process.env`
 * again — a missing variable is a startup failure, not a 3am null deref.
 *
 * Every external endpoint configured here resolves inside the EU (D9). Adding a
 * variable that points at a new service means updating the sub-processor
 * register first.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /**
     * 8787, the port the worker used to listen on: `apps/web` reaches this
     * process through `WORKER_URL`, and keeping the port means a local checkout
     * keeps working across the split (ADR-034).
     */
    API_PORT: z.coerce.number().int().positive().default(8787),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    /**
     * Required, with no default. pg-boss would otherwise fail on its first poll
     * — a minute after boot, in a log nobody is reading — instead of here, where
     * the process refuses to start and says why.
     */
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required for the job queue'),

    /**
     * Shared secret guarding `/jobs/*`. The name predates ADR-034, when this
     * surface lived in the worker; it is kept so web's configuration did not
     * have to change with the split.
     *
     * Required, with no default, for the same reason as the URL above: a default
     * would be a published password. A minimum length because a two-character
     * secret is an unlocked door with a sign on it.
     */
    WORKER_INTERNAL_TOKEN: z
      .string()
      .min(24, 'WORKER_INTERNAL_TOKEN must be at least 24 characters'),

    /**
     * MEMO: `mock` is the only implementation today and it moves no money
     * (ADR-010, staged like the PMS connector in ADR-008). The worker refuses to
     * boot with a simulated provider when NODE_ENV=production — see index.ts.
     */
    PAYMENT_PROVIDER: z.string().default('mock'),

    /**
     * Shared secret the provider signs webhooks with.
     *
     * The webhook endpoint is deliberately unauthenticated at the transport
     * level — a provider cannot present our bearer token — so this signature is
     * the *only* thing standing between a stranger and marking bookings as paid.
     */
    PAYMENT_WEBHOOK_SECRET: z
      .string()
      .min(24, 'PAYMENT_WEBHOOK_SECRET must be at least 24 characters'),

    /**
     * Webhook requests per minute per client address (ADR-032 item 5). Far above
     * any provider's real rate: the limit exists for floods, and providers retry
     * a 429 with backoff.
     */
    WEBHOOK_RATE_LIMIT: z.coerce.number().int().positive().default(120),

    /**
     * Whether `X-Forwarded-For` names the client — true only behind a proxy we
     * run (Caddy on the VM, Cloud Run's front end). Otherwise any caller could
     * choose its own rate-limit key.
     */
    TRUST_PROXY: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),

    /**
     * Twilio (ADR-035). Both or neither: the token checks webhook signatures and
     * the base URL is the exact public address Twilio signs. Neither, and the
     * Twilio routes answer 404.
     */
    TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
    TWILIO_WEBHOOK_BASE_URL: z.string().url().optional(),

    /** Where the guest comes back to, and where the simulated checkout lives. */
    APP_URL: z.string().url().default('http://localhost:3000'),
  })
  .refine((env) => Boolean(env.TWILIO_AUTH_TOKEN) === Boolean(env.TWILIO_WEBHOOK_BASE_URL), {
    message: 'TWILIO_AUTH_TOKEN and TWILIO_WEBHOOK_BASE_URL are set together or not at all',
    path: ['TWILIO_WEBHOOK_BASE_URL'],
  })

export type Env = z.infer<typeof envSchema>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source)

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid api environment:\n${issues}`)
  }

  return parsed.data
}
