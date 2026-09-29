import { existsSync } from 'node:fs'
import { createLogger, startTelemetry } from '@bookone/telemetry'
import { fileURLToPath } from 'node:url'
import { MockEricsoftAdapter } from '@bookone/adapters/mock-ericsoft'
import { MockPaymentAdapter } from '@bookone/adapters/mock-payment'
import { createAlloggiatiAdapter } from './alloggiati'
import {
  COMPLIANCE_ALERT,
  ESCALATION_ALERT,
  getNotificationProvider,
  registerNotificationProvider,
} from '@bookone/core/notifications'
import { openRouterFromEnv, registerProvider } from '@bookone/core/llm'
import { loadProfiles } from '@bookone/agents/profiles'
import { LogNotificationProvider } from './notifications/log-provider'
import { TwilioClient, TwilioError, TwilioNotificationProvider } from '@bookone/adapters/twilio'
import { createDocumentDeleter, createDocumentReader } from './storage/documents'
import { loadEnv } from './env'
import { registerHandlers } from './jobs/handlers'
import { registerSchedules } from './jobs/schedules'
import { PgBossQueue } from '@bookone/adapters/pg-boss'

/**
 * The repo-root `.env`, for local development.
 *
 * Loaded here rather than through node's `--env-file` flag in the dev script:
 * `tsx watch` re-executes the entry on change without re-passing node's own CLI
 * flags, so the first boot finds its configuration and every reload after it
 * does not — a failure that reads as "the code broke" rather than "the
 * environment vanished".
 *
 * Deployed environments supply real environment variables and have no file
 * here, which is why the check is silent rather than a startup crash. Nothing
 * already set is overwritten, so an explicit variable always wins.
 */
const envFile = fileURLToPath(new URL('../../../.env', import.meta.url))
if (existsSync(envFile)) process.loadEnvFile(envFile)

// ADR-003: persistent Node process. Not edge, not serverless — see README.
// No HTTP ingress since ADR-034: webhooks and /jobs/* are apps/api's.
// The queue subscriptions and connector polling below are exactly why.
const env = loadEnv()

/**
 * OpenTelemetry first (ADR-036): traces, metrics and logs over OTLP when
 * OTEL_EXPORTER_OTLP_ENDPOINT is set, nothing at all when it is not. The
 * logger is redacted and carries the trace id on every line.
 */
const telemetry = startTelemetry({ serviceName: 'bookone-worker' })
const logger = createLogger({ name: 'bookone-worker', level: env.LOG_LEVEL })

/**
 * The PMS connector.
 *
 * Mock until WS-C clears (ADR-008). The real adapter drops in here and nothing
 * else changes — it implements the same interface and has already passed the
 * same contract suite, which is the precondition for the swap.
 */
const adapter = new MockEricsoftAdapter({
  // A live clock. The mock's default is a fixed instant, which is right for
  // tests and wrong here: `fetched_at` is what the booking surface checks for
  // staleness, and a frozen timestamp would either vouch for a cache that has
  // not been refreshed in days or condemn one refreshed a second ago.
  now: () => new Date(),

  // The codes the seeded properties actually use. A real PMS knows the hotel's
  // room types; the mock has to be told, and telling it wrong is invisible —
  // the refresh logs a `skipped` count and the booking page quietly stops
  // offering that room. Keep this in step with `scripts/seed-dev.mjs`.
  roomTypeCodes: ['DBL', 'SGL', 'FAM'],
})

/**
 * The payment provider.
 *
 * MEMO — SIMULATED. `MockPaymentAdapter` moves no money (ADR-010, staged the
 * same way ADR-008 staged the PMS connector). The interface, the policy engine,
 * the ledger, the webhook path and its signature check are all real; the card
 * form and the authorisation are not.
 *
 * The guard below is what keeps that a staging decision rather than an accident
 * waiting to happen. It is deliberately a hard exit and not a warning: a
 * warning in a startup log is a warning nobody reads until a guest has been
 * shown a payment page that takes no money.
 */
const paymentAdapter = new MockPaymentAdapter({
  webhookSecret: env.PAYMENT_WEBHOOK_SECRET,
  checkoutBaseUrl: env.APP_URL,
})

if (env.NODE_ENV === 'production' && paymentAdapter.simulated) {
  throw new Error(
    `Refusing to start: payment provider "${paymentAdapter.provider}" is simulated and ` +
      'NODE_ENV=production. Connect a real PaymentAdapter (ADR-010) before deploying.',
  )
}

/**
 * The Alloggiati channel.
 *
 * MEMO — SIMULATED. Nothing is filed with any authority. The direct-web-service
 * versus certified-intermediary decision is still open (04 §0 item 5), so this
 * ships behind a port exactly as the PMS connector and payments did. The
 * choice is `ALLOGGIATI_CHANNEL`: the mock, or the Alloggiati Web adapter on
 * the local simulator (WP1.2).
 *
 * The guard below matters more here than for payments. A property that believes
 * its guests are registered when nothing was filed is a property facing a fine
 * for a breach it does not know about — so a simulated channel refuses to boot
 * in production, loudly, rather than warning into a log nobody reads.
 */
const alloggiatiAdapter = await createAlloggiatiAdapter(env)

if (env.NODE_ENV === 'production' && alloggiatiAdapter.simulated) {
  throw new Error(
    `Refusing to start: Alloggiati channel "${alloggiatiAdapter.channel}" is simulated and ` +
      'NODE_ENV=production. Nothing would be filed with the authority. Connect a real ' +
      'AlloggiatiAdapter (docs/runbooks/alloggiati.md) before deploying.',
  )
}

/** E2.4. See the module for why it reports failure rather than swallowing it. */
const deleteObject = createDocumentDeleter(logger)
const readObject = createDocumentReader(logger)

const queue = new PgBossQueue(env.DATABASE_URL)

/**
 * Registration is the D9 gate, not a lookup table (ADR-012's pattern, applied
 * to an ESP). A provider that cannot declare EU processing, a region, a
 * sub-processor register entry and a verification inside a year is refused
 * here — at boot, loudly, before a guest's address is ever handed to it.
 */
registerNotificationProvider(new LogNotificationProvider(logger))

const notifications = getNotificationProvider(env.NOTIFICATION_PROVIDER)

/**
 * WhatsApp and SMS through Twilio (ADR-035), when configured. It passes the
 * same registration gate, admitted only as ADR-035's recorded exception with
 * register entry SP-013 — the gate refuses it otherwise.
 */
const twilioClient =
  env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN
    ? new TwilioClient({
        accountSid: env.TWILIO_ACCOUNT_SID,
        authToken: env.TWILIO_AUTH_TOKEN,
        region: env.TWILIO_REGION,
      })
    : null
const messaging = twilioClient
  ? {
      provider: new TwilioNotificationProvider({
        client: twilioClient,
        region: env.TWILIO_REGION,
        ...(env.TWILIO_WHATSAPP_FROM ? { whatsappFrom: env.TWILIO_WHATSAPP_FROM } : {}),
        ...(env.TWILIO_SMS_FROM ? { smsFrom: env.TWILIO_SMS_FROM } : {}),
        ...(env.TWILIO_WEBHOOK_BASE_URL ? { webhookBaseUrl: env.TWILIO_WEBHOOK_BASE_URL } : {}),
      }),
      purge: (sid: string) => twilioClient.deleteMessage(sid),
      retryable: (error: unknown) => error instanceof TwilioError && error.retryable,
    }
  : null
if (messaging) registerNotificationProvider(messaging.provider)

/**
 * The concierge's profiles, validated now (ADR-021). A malformed profile stops
 * the process here, naming the file and the reason — not later, as a guest who
 * never gets an answer.
 */
const profiles = loadProfiles()

/**
 * The model gateway, if configured (ADR-023, ADR-029). Registration runs the
 * residency gate: OpenRouter is admitted only as ADR-029's recorded exception,
 * with its register entry. No key, no model — the orchestrator routes by rules.
 */
const llm = openRouterFromEnv(env)
if (llm) registerProvider(llm)

await queue.start()
await registerHandlers({
  queue,
  adapter,
  payments: paymentAdapter,
  alloggiati: alloggiatiAdapter,
  notifications,
  deleteObject,
  readObject,
  appUrl: env.APP_URL,
  logger,
  messaging,
  whatsappTemplates: {
    ...(env.TWILIO_TEMPLATE_ESCALATION_ALERT
      ? { [ESCALATION_ALERT]: env.TWILIO_TEMPLATE_ESCALATION_ALERT }
      : {}),
    ...(env.TWILIO_TEMPLATE_COMPLIANCE_ALERT
      ? { [COMPLIANCE_ALERT]: env.TWILIO_TEMPLATE_COMPLIANCE_ALERT }
      : {}),
  },
})
await registerSchedules({ queue, logger })
logger.info(
  {
    adapter: adapter.system,
    notifications: notifications.name,
    messaging: messaging
      ? `${messaging.provider.name} (${messaging.provider.channels.join(', ') || 'no sender set'})`
      : 'none',
    payments: paymentAdapter.provider,
    alloggiati: alloggiatiAdapter.channel,
    alloggiatiSimulated: alloggiatiAdapter.simulated,
    // Printed on every boot on purpose. "Which environment is taking real
    // money" should never be a question anyone has to go and look up.
    paymentsSimulated: paymentAdapter.simulated,
    // Which model answers guests, or none. Printed for the same reason.
    llm: llm ? `${llm.name} (${llm.residency.region})` : 'none — routing by rules',
    profiles: profiles.size,
  },
  'queue started, handlers registered',
)

/**
 * Drain rather than exit.
 *
 * This process holds queue subscriptions and, later, connector polling loops. A
 * hard exit mid-reflection leaves a job claimed but unfinished, and it stays
 * that way until the visibility timeout expires — which is a booking the hotel
 * has not heard about for as long as that takes.
 */
let shuttingDown = false

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    if (shuttingDown) return
    shuttingDown = true

    logger.info({ signal }, 'shutting down')

    void queue
      .stop()
      .then(() => telemetry.shutdown())
      .then(() => process.exit(0))
  })
}
