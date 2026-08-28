import type { Logger } from 'pino'
import type {
  NotificationChannel,
  NotificationProvider,
  OutboundMessage,
  SendResult,
} from '@bookone/core/notifications'

/**
 * The development email provider: it writes the message to the log.
 *
 * This exists because **the real one is not a code decision yet.** Every
 * candidate ESP is a sub-processor of guest personal data — names, addresses,
 * and the contents of a message about someone's travel — so D9 requires the
 * region pinned, the register updated and the DPA signed before a key is set,
 * and none of that is unblocked by writing an integration first.
 *
 * What this does buy, today: the whole path is real. The outbox row is written
 * in the confirming transaction, the job is enqueued, the template renders in
 * the guest's locale, the row moves to `sent` with a provider id, and the event
 * is logged. Swapping in the real provider changes one registration and nothing
 * else — and it has to pass the same residency gate this one does.
 *
 * It is registered under a name that cannot be mistaken for a real service in a
 * log line, because at some point somebody will read one at 3am.
 */
export class LogNotificationProvider implements NotificationProvider {
  readonly name = 'log'
  readonly channels: readonly NotificationChannel[] = ['email']

  /**
   * Truthful, and it passes the gate for the honest reason rather than by
   * exemption: this provider transmits nothing anywhere. The message reaches a
   * log on the machine already holding the database.
   */
  readonly residency = {
    euProcessing: true,
    region: 'local',
    subProcessorRegisterEntry: 'none — no data leaves the process',
    verifiedAt: '2026-08-28',
  }

  constructor(private readonly logger: Logger) {}

  send(message: OutboundMessage): Promise<SendResult> {
    this.logger.info(
      {
        channel: message.channel,
        to: message.to,
        locale: message.locale,
        subject: message.subject,
        body: message.body,
      },
      'notification (log provider — nothing was actually sent)',
    )

    // A synthetic id, prefixed so nobody mistakes it for a provider's. The
    // column exists to trace a delivery complaint; a null here would look like
    // a provider that failed to return one.
    return Promise.resolve({ providerMessageId: `log:${crypto.randomUUID()}` })
  }
}
