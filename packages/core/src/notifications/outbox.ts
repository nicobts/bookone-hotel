import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { and, asc, eq, inArray, lt } from 'drizzle-orm'
import { asService } from '../db/session'
import { notifications } from '../db/schema'
import type * as schema from '../db/schema'
import { emit } from '../events'
import { systemActor } from '../events/actor'
import {
  renderBookingConfirmation,
  renderBookingRequest,
  type BookingConfirmationFacts,
  type BookingRequestFacts,
} from './templates'
import {
  UnsupportedChannelError,
  type NotificationChannel,
  type NotificationProvider,
} from './provider'

/**
 * The outbox (E1.2).
 *
 * Queuing happens inside the transaction that commits the thing being
 * announced; sending happens afterwards, from the worker. That split is the
 * whole point: the alternative is confirming a booking and then calling an
 * email provider, where a crash in between leaves a confirmed guest nobody told,
 * and a timeout after a successful send leaves a retry that tells them twice.
 *
 * Both failure modes are silent, and both are the kind a hotel discovers from
 * an angry guest rather than from a dashboard.
 */

type Tx = PostgresJsDatabase<typeof schema>

export const BOOKING_CONFIRMATION = 'booking.confirmation'

/**
 * A guest asking the property for dates the engine could not price.
 *
 * The fallback when availability is stale (E1.1). It goes to the *property*,
 * not the guest, and it carries no reservation — there is no booking, which is
 * the whole reason the message exists.
 */
export const BOOKING_REQUEST = 'booking.request'

export interface QueueInput {
  propertyId: string
  /**
   * Optional: a message about no particular stay still belongs in the outbox.
   * Note the deduplication constraint does not bind on null in Postgres, which
   * is correct here — two guests asking about the same dates are two messages.
   */
  reservationId?: string
  channel: NotificationChannel
  template: string
  locale: string
  recipient: string
  /** The facts the template will render from, captured now (see the column). */
  payload: Record<string, unknown>
}

/**
 * Writes one queued row **in the caller's transaction**.
 *
 * Takes the transaction handle for the same reason `emit` does: the message and
 * the thing it announces commit together or not at all.
 *
 * Returns null when the row already existed. The unique constraint on
 * (reservation, template, channel) is what makes the confirmation path safe to
 * reach from a retry, an owner re-sending, and a Sprint 4 webhook replay — all
 * three of which will happen, and none of which should mail the guest again.
 */
export async function queueNotification(tx: Tx, input: QueueInput): Promise<string | null> {
  const [row] = await tx
    .insert(notifications)
    .values({
      propertyId: input.propertyId,
      reservationId: input.reservationId ?? null,
      channel: input.channel,
      template: input.template,
      locale: input.locale,
      recipient: input.recipient,
      payload: input.payload,
    })
    .onConflictDoNothing({
      target: [notifications.reservationId, notifications.template, notifications.channel],
    })
    .returning({ id: notifications.id })

  return row?.id ?? null
}

export type SendOutcome =
  | { status: 'sent'; providerMessageId: string | null }
  /** Already sent. The job ran twice; the guest is not told twice. */
  | { status: 'already-sent' }
  | { status: 'not-found' }
  /** The provider refused or was unreachable. The row records why. */
  | { status: 'failed'; error: string; retryable: boolean }

/**
 * Renders and sends one queued message, then records what happened.
 *
 * The row is the evidence: `created_at` to `sent_at` is E1.2's 60-second
 * measurement, per message, with nobody having to instrument anything.
 */
export async function sendNotification(
  deps: { provider: NotificationProvider },
  input: { notificationId: string },
): Promise<SendOutcome> {
  const { provider } = deps

  const loaded = await asService(async (db) => {
    const [row] = await db
      .select({
        id: notifications.id,
        propertyId: notifications.propertyId,
        reservationId: notifications.reservationId,
        channel: notifications.channel,
        template: notifications.template,
        locale: notifications.locale,
        recipient: notifications.recipient,
        payload: notifications.payload,
        status: notifications.status,
        attempts: notifications.attempts,
      })
      .from(notifications)
      .where(eq(notifications.id, input.notificationId))
      .limit(1)

    return row ?? null
  })

  if (!loaded) return { status: 'not-found' }
  if (loaded.status === 'sent') return { status: 'already-sent' }
  if (loaded.status === 'suppressed') return { status: 'already-sent' }

  if (!provider.channels.includes(loaded.channel)) {
    const error = new UnsupportedChannelError(provider.name, loaded.channel)
    await recordFailure(loaded, provider.name, error.message)

    return { status: 'failed', error: error.message, retryable: false }
  }

  let rendered
  try {
    rendered = render(loaded.template, loaded.locale, loaded.payload)
  } catch (cause) {
    // A template that cannot render will not render on the next attempt
    // either. Recorded and left alone rather than retried forever.
    const message = cause instanceof Error ? cause.message : String(cause)
    await recordFailure(loaded, provider.name, message)

    return { status: 'failed', error: message, retryable: false }
  }

  try {
    const result = await provider.send({
      channel: loaded.channel,
      to: loaded.recipient,
      subject: rendered.subject,
      body: rendered.body,
      locale: loaded.locale,
    })

    await asService((db) =>
      db.transaction(async (tx) => {
        await tx
          .update(notifications)
          .set({
            status: 'sent',
            attempts: loaded.attempts + 1,
            provider: provider.name,
            providerMessageId: result.providerMessageId ?? null,
            sentAt: new Date(),
          })
          .where(eq(notifications.id, loaded.id))

        await emit(tx, {
          propertyId: loaded.propertyId,
          entityType: 'notification',
          entityId: loaded.id,
          eventType: 'notification.sent',
          origin: 'platform',
          actor: systemActor,
          payload: {
            channel: loaded.channel,
            template: loaded.template,
            provider: provider.name,
            reservationId: loaded.reservationId,
            // Deliberately not the recipient address. The event log is read far
            // more widely than the outbox, and an address belongs in the one
            // table whose policy was written for it.
          },
        })
      }),
    )

    return { status: 'sent', providerMessageId: result.providerMessageId ?? null }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    await recordFailure(loaded, provider.name, message)

    // Network and provider errors are the retryable kind, and the queue's own
    // retry policy decides how often. Saying so here keeps the decision with
    // the code that knows what failed.
    return { status: 'failed', error: message, retryable: true }
  }
}

async function recordFailure(
  row: { id: string; propertyId: string; attempts: number },
  providerName: string,
  message: string,
): Promise<void> {
  await asService((db) =>
    db.transaction(async (tx) => {
      await tx
        .update(notifications)
        .set({
          status: 'failed',
          attempts: row.attempts + 1,
          provider: providerName,
          lastError: message,
        })
        .where(eq(notifications.id, row.id))

      await emit(tx, {
        propertyId: row.propertyId,
        entityType: 'notification',
        entityId: row.id,
        eventType: 'notification.failed',
        origin: 'platform',
        actor: systemActor,
        payload: { provider: providerName, error: message },
      })
    }),
  )
}

function render(template: string, locale: string, payload: unknown) {
  if (template === BOOKING_CONFIRMATION) {
    return renderBookingConfirmation(locale, payload as BookingConfirmationFacts)
  }

  if (template === BOOKING_REQUEST) {
    return renderBookingRequest(locale, payload as BookingRequestFacts)
  }

  throw new Error(`unknown notification template "${template}"`)
}

/**
 * Queued rows the direct enqueue never got to.
 *
 * The confirmation path enqueues a send job immediately, because E1.2 gives us
 * sixty seconds and a sweep alone would spend most of them waiting. This is the
 * other half: if that enqueue is lost — the process died between commit and
 * enqueue, the queue was briefly unreachable — the message is still in the
 * table, and this finds it. Without the sweep the outbox is just a log of
 * things we meant to send.
 */
export async function listPendingNotifications(input: {
  olderThanSeconds: number
  limit: number
  now?: Date
}): Promise<{ id: string; propertyId: string }[]> {
  const cutoff = new Date((input.now ?? new Date()).getTime() - input.olderThanSeconds * 1000)

  return asService((db) =>
    db
      .select({ id: notifications.id, propertyId: notifications.propertyId })
      .from(notifications)
      .where(and(inArray(notifications.status, ['queued']), lt(notifications.createdAt, cutoff)))
      .orderBy(asc(notifications.createdAt))
      .limit(input.limit),
  )
}
