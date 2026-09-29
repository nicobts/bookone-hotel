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
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /**
   * Required, with no default. pg-boss would otherwise fail on its first poll
   * — a minute after boot, in a log nobody is reading — instead of here, where
   * the process refuses to start and says why.
   */
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required for the job queue'),

  /**
   * Which outbound provider sends guest messages.
   *
   * `log` writes them to the log and transmits nothing — the default until an
   * ESP clears D9 (region pinned, sub-processor register updated, DPA signed).
   * Naming a provider that has not been registered fails at boot, which is the
   * intended outcome: the residency gate is not skippable by setting a variable.
   */
  NOTIFICATION_PROVIDER: z.string().default('log'),

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
   * The model gateway (ADR-023, ADR-029). All optional: without a key no model
   * is registered and the concierge routes by rules — the state CI runs in.
   * A key without a model per tier refuses to boot (`openRouterFromEnv`).
   */
  OPENROUTER_API_KEY: z.string().optional(),
  LLM_MODEL_SMALL: z.string().optional(),
  LLM_MODEL_STRONG: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().optional(),

  /** Where the guest comes back to, and where the simulated checkout lives. */
  APP_URL: z.string().url().default('http://localhost:3000'),

  /**
   * Twilio, for WhatsApp and SMS (ADR-035). All optional: without the account
   * SID and token nothing is sent on those channels and the jobs log instead.
   * A channel is offered only when its sender number is set.
   */
  TWILIO_ACCOUNT_SID: z.string().startsWith('AC').optional(),
  TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
  /** `ie1` keeps Twilio's processing and log in Ireland; needs IE1 credentials. */
  TWILIO_REGION: z.enum(['us1', 'ie1']).default('us1'),
  TWILIO_WHATSAPP_FROM: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/)
    .optional(),
  TWILIO_SMS_FROM: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/)
    .optional(),
  /**
   * The approved WhatsApp template (Twilio Content SID, `HX…`) for the owner's
   * handover alert: {{1}} who is waiting, {{2}} the link. Needed because an
   * alert starts the conversation, which WhatsApp allows only as a template.
   */
  TWILIO_TEMPLATE_ESCALATION_ALERT: z.string().startsWith('HX').optional(),
  /** The compliance deadline alert's approved template (WP1.5): {{1}} whose filing, {{2}} by when, {{3}} the link. */
  TWILIO_TEMPLATE_COMPLIANCE_ALERT: z.string().startsWith('HX').optional(),
  /** `apps/api`'s public URL, for delivery-status callbacks. */
  TWILIO_WEBHOOK_BASE_URL: z.string().url().optional(),

  /**
   * The Alloggiati channel (WP1.2). `mock` files nothing and needs nothing.
   * `simulator` talks to the local Alloggiati Web simulator
   * (`pnpm alloggiati:simulator`) with the registry's code tables, and still
   * files nothing: the adapter refuses any host but this machine. There is no
   * value for the real service yet (docs/runbooks/alloggiati.md).
   */
  ALLOGGIATI_CHANNEL: z.enum(['mock', 'simulator']).default('mock'),
  ALLOGGIATI_ENDPOINT: z.string().url().optional(),
  /** The code tables: an operator-downloaded official set, or `content/alloggiati/synthetic`. */
  ALLOGGIATI_TABLES_DIR: z.string().min(1).optional(),
  /** The simulator's test user. Not a secret: the simulator accepts nothing else. */
  ALLOGGIATI_SIMULATOR_USERNAME: z.string().default('TS000001'),
  ALLOGGIATI_SIMULATOR_PASSWORD: z.string().default('simulator'),
  ALLOGGIATI_SIMULATOR_WSKEY: z.string().default('SIMKEY'),
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
