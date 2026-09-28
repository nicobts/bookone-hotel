'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { flash } from '@bookone/ui/lib/flash-server'
import {
  appendStaffMessage,
  createStayTask,
  decideApproval,
  deskPhrase,
  getThreadForReservation,
  listPendingApprovals,
} from '@bookone/core/concierge'
import { userActor } from '@bookone/core/events'
import { requireFeature } from '@/lib/auth/current-property'
import { requestCancellation, startCheckout } from '@/lib/worker'

/**
 * Deciding what the concierge held for a person (Guest Desk WP0.6).
 *
 * Approve: carry the action out, then record the decision and tell the guest.
 * In that order — a cancellation that failed must not be recorded as approved,
 * and the guest must not be told of a link that does not exist. Both carriers
 * are idempotent (a second cancel is `already-cancelled`, a second checkout is
 * `already-started`), so a double tap cannot do the thing twice.
 *
 * Reject: record it and always tell the guest a person will follow up — a
 * rejection never leaves them without a reply (WP0.6 AC).
 *
 * The guest's message is a staff message in their language, which also puts
 * the thread with the person who decided: after a decision about their money,
 * continuity with a person is the point. Any member may decide; the actor is
 * named on the run (`reviewed_by`) and in the event log.
 *
 * Each outcome is flashed as a toast (`@bookone/ui/lib/flash`): what was done,
 * and that the guest was told — or, on failure, that the guest was not.
 */
interface Context {
  locale: string
  slug: string
}

function page(context: Context, query = ''): string {
  return `/${context.locale}/${context.slug}/console/approvals${query}`
}

async function pendingFor(propertyId: string, runId: string) {
  return (await listPendingApprovals(propertyId)).find((pending) => pending.runId === runId) ?? null
}

function toasts(context: Context) {
  return getTranslations({ locale: context.locale, namespace: 'console.approvals.toast' })
}

/** Someone else decided first, or the run is gone: say so, change nothing. */
async function alreadyDecided(context: Context): Promise<never> {
  await flash.info((await toasts(context))('gone'))
  redirect(page(context))
}

async function failed(context: Context, reason: string): Promise<never> {
  const t = await toasts(context)
  await flash.error(t('failed'), t('failedDescription', { reason }))
  redirect(page(context))
}

export async function approveAction(context: Context, formData: FormData): Promise<void> {
  const { user, property } = await requireFeature(context.locale, context.slug, 'concierge')
  const pending = await pendingFor(property.id, String(formData.get('runId') ?? ''))
  if (!pending?.threadId || !pending.reservationId) return alreadyDecided(context)

  const thread = await getThreadForReservation(property.id, pending.reservationId)
  const locale = thread?.locale ?? context.locale
  let message: string

  switch (pending.tool) {
    case 'request_late_checkout': {
      const time = typeof pending.input.time === 'string' ? pending.input.time : ''
      await createStayTask({
        propertyId: property.id,
        reservationId: pending.reservationId,
        threadId: pending.threadId,
        summary: `Late checkout until ${time} — approved.`,
        actor: userActor(user.id),
      })
      message = deskPhrase(locale, 'decisionLateCheckout', { time })
      break
    }

    case 'cancel_booking': {
      const outcome = await requestCancellation({
        propertyId: property.id,
        reservationId: pending.reservationId,
      })
      if (outcome.status !== 'cancelled' && outcome.status !== 'already-cancelled') {
        return failed(context, outcome.status)
      }
      message = deskPhrase(locale, 'decisionCancelled')
      break
    }

    case 'create_payment_link': {
      const origin = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? ''
      const outcome = await startCheckout({
        propertyId: property.id,
        reservationId: pending.reservationId,
        returnUrl: `${origin}/${locale}`,
      })
      // Today's checkout is the booking flow's deposit step; a balance link for
      // a confirmed stay does not exist yet, and saying so beats inventing one.
      if (!outcome.checkoutUrl) {
        return failed(context, outcome.reason ?? outcome.status)
      }
      message = deskPhrase(locale, 'decisionPaymentLink', { url: outcome.checkoutUrl })
      break
    }

    default:
      return failed(context, `no approval path for ${pending.tool}`)
  }

  const decided = await decideApproval({
    propertyId: property.id,
    runId: pending.runId,
    decision: 'accepted',
    userId: user.id,
  })

  if (decided.status === 'decided') {
    await appendStaffMessage({
      propertyId: property.id,
      threadId: pending.threadId,
      userId: user.id,
      body: message,
    })
    const t = await toasts(context)
    await flash.success(t('approved'), t('approvedDescription'))
  } else {
    await flash.info((await toasts(context))('gone'))
  }

  revalidatePath(page(context))
  redirect(page(context))
}

export async function rejectAction(context: Context, formData: FormData): Promise<void> {
  const { user, property } = await requireFeature(context.locale, context.slug, 'concierge')
  const pending = await pendingFor(property.id, String(formData.get('runId') ?? ''))
  if (!pending?.threadId || !pending.reservationId) return alreadyDecided(context)

  const decided = await decideApproval({
    propertyId: property.id,
    runId: pending.runId,
    decision: 'rejected',
    userId: user.id,
  })

  if (decided.status === 'decided') {
    const thread = await getThreadForReservation(property.id, pending.reservationId)
    await appendStaffMessage({
      propertyId: property.id,
      threadId: pending.threadId,
      userId: user.id,
      body: deskPhrase(thread?.locale ?? context.locale, 'decisionRejected'),
    })
    const t = await toasts(context)
    await flash.success(t('rejected'), t('rejectedDescription'))
  } else {
    await flash.info((await toasts(context))('gone'))
  }

  revalidatePath(page(context))
  redirect(page(context))
}
