'use server'

import { revalidatePath } from 'next/cache'
import { requireProperty } from '@/lib/auth/current-property'
import { retryReflection } from '@/lib/worker'

/**
 * The one-tap resolution behind an unreflected reservation (PRD C1).
 *
 * Safe to press repeatedly, at three separate layers: the queue collapses
 * duplicate sends on the singleton key, `reflectReservation` returns early when
 * an `external_refs` row already exists, and the adapter is idempotent
 * underneath both. An owner tapping this four times still produces one booking
 * in their PMS.
 *
 * Authorisation is `requireProperty`, which resolves the property *through the
 * signed-in user's memberships* — so a reservation id from another property
 * cannot be retried by pasting it here: the property behind it never resolves
 * for this person, and the id is scoped to that property when the job runs.
 */
export async function retryReflectionAction(
  context: { locale: string; slug: string },
  formData: FormData,
): Promise<void> {
  const { property } = await requireProperty(context.locale, context.slug)

  const reservationId = String(formData.get('reservationId') ?? '')
  if (!reservationId) return

  await retryReflection({ propertyId: property.id, reservationId })

  // The row disappears from the inbox once the reflection lands, which takes a
  // moment. Revalidating now shows the list as it is rather than as it was —
  // and if the job has not finished, the row is still there, which is honest.
  revalidatePath(`/${context.locale}/${context.slug}/console/exceptions`)
}
