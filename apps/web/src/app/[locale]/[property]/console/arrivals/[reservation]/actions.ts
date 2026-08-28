'use server'

import { revalidatePath } from 'next/cache'
import { requireProperty } from '@/lib/auth/current-property'
import { confirmArrival, submitAlloggiatiNow } from '@/lib/worker'

/**
 * The two things a receptionist does on this screen (E2.3, E3.1).
 *
 * Both resolve the property through `requireProperty`, which resolves it
 * *through the signed-in user's memberships* — so a reservation id pasted from
 * another property cannot be acted on: the property behind it never resolves
 * for this person, and the worker scopes the command to that property anyway.
 */

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

  await confirmArrival({
    propertyId: property.id,
    reservationId: context.reservationId,
    // Named. "Who marked this guest arrived" is a question that gets asked at
    // a desk with three people on shift.
    userId: user.id,
  })

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
  const { property } = await requireProperty(context.locale, context.slug)

  await submitAlloggiatiNow({ propertyId: property.id, reservationId: context.reservationId })

  revalidatePath(`/${context.locale}/${context.slug}/console/arrivals/${context.reservationId}`)
}
