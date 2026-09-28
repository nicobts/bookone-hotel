'use server'

import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { flash } from '@bookone/ui/lib/flash-server'
import { requireFeature, requireProperty } from '@/lib/auth/current-property'
import { confirmArrival, submitAlloggiatiNow } from '@/lib/worker'
import { confirmDocuments } from '@bookone/core/journey'

/**
 * The two things a receptionist does on this screen (E2.3, E3.1).
 *
 * Both resolve the property through `requireProperty`, which resolves it
 * *through the signed-in user's memberships* — so a reservation id pasted from
 * another property cannot be acted on: the property behind it never resolves
 * for this person, and the worker scopes the command to that property anyway.
 *
 * Each outcome is flashed as a toast (`@bookone/ui/lib/flash`). The worker
 * calls are best-effort, so "could not reach" is said rather than swallowed:
 * a receptionist who believes a guest is checked in when they are not finds
 * out at the worst moment.
 */

function toasts(context: Context) {
  return getTranslations({ locale: context.locale, namespace: 'console.arrival.toast' })
}

interface Context {
  locale: string
  slug: string
  reservationId: string
}

/**
 * The guest is here.
 *
 * One of three trigger sources for the same journey command (ADR-013) — a staff
 * tap now, a guest tap on the stay surface, and a door event from Rooms later.
 * None of them is special, which is what lets the third arrive without touching
 * the journey.
 */
export async function markArrived(context: Context): Promise<void> {
  const { user, property } = await requireProperty(context.locale, context.slug)

  const sent = await confirmArrival({
    propertyId: property.id,
    reservationId: context.reservationId,
    // Named. "Who marked this guest arrived" is a question that gets asked at
    // a desk with three people on shift.
    userId: user.id,
    source: 'staff',
  })

  const t = await toasts(context)
  if (sent) await flash.success(t('arrived'), t('arrivedDescription'))
  else await flash.error(t('unreachable'), t('unreachableDescription'))

  revalidatePath(`/${context.locale}/${context.slug}/console/arrivals/${context.reservationId}`)
}

/**
 * File this stay with the registry now (E2.3).
 *
 * Always available, whatever the automation did. The property is the declarant
 * and an owner who cannot act without us is an owner whose legal compliance
 * depends on our uptime.
 */
export async function fileNow(context: Context): Promise<void> {
  const { property } = await requireFeature(context.locale, context.slug, 'alloggiati')

  const sent = await submitAlloggiatiNow({
    propertyId: property.id,
    reservationId: context.reservationId,
  })

  const t = await toasts(context)
  if (sent) await flash.info(t('filing'), t('filingDescription'))
  else await flash.error(t('unreachable'), t('unreachableDescription'))

  revalidatePath(`/${context.locale}/${context.slug}/console/arrivals/${context.reservationId}`)
}

/**
 * A person confirms the party's registration record against the documents
 * (Guest Desk WP0.4 "Conferma"). Pre-arrival capture ends here in Phase 0:
 * nothing is filed. Refused by core unless the record is complete and every
 * guest has a document; the actor is named, because the confirmation is theirs
 * and not BookOne's (ADR-027).
 */
export async function confirmDocumentsAction(context: Context): Promise<void> {
  const { user, property } = await requireFeature(context.locale, context.slug, 'prearrival')

  const outcome = await confirmDocuments({
    propertyId: property.id,
    reservationId: context.reservationId,
    userId: user.id,
  })

  const t = await toasts(context)
  if (outcome.status === 'confirmed') await flash.success(t('confirmed'), t('confirmedDescription'))
  else await flash.error(t('notConfirmed'), t('notConfirmedDescription'))

  revalidatePath(`/${context.locale}/${context.slug}/console/arrivals/${context.reservationId}`)
}
