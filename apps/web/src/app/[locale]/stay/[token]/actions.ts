'use server'

import { redirect } from 'next/navigation'
import {
  recordDocument,
  resolveStay,
  saveParty,
  setExpectedArrival,
  type PartyInput,
} from '@bookone/core/journey'
import { storeIdentityDocument } from '@/lib/storage'

/**
 * The pre-arrival writes (E2.1, E2.2).
 *
 * Every one of them starts by resolving the token again. The token is the whole
 * of the guest's authorisation and a form post is a new request from an
 * untrusted client — "we resolved it when we rendered the page" is not a
 * property of anything that arrives over the network.
 *
 * Resolving also re-reads the reservation, so a stay cancelled between page
 * load and submit stops accepting writes without anything having to be revoked.
 */

interface Context {
  locale: string
  token: string
}

function stayUrl(context: Context, extra = ''): string {
  return `/${context.locale}/stay/${context.token}${extra}`
}

/** Who is travelling (E2.1). Upserts by index, so resubmitting is safe. */
export async function submitParty(context: Context, formData: FormData): Promise<void> {
  const resolved = await resolveStay(context.token)
  if (!resolved.ok) redirect(stayUrl(context))

  const { stay } = resolved

  // The party size comes from the reservation, not the form. A guest cannot
  // register eight people into a double room by editing a hidden field, and the
  // number of people in the room is a fact the booking already settled.
  const size = Math.max(1, stay.adults + stay.children)

  const members: PartyInput[] = []

  for (let index = 0; index < size; index += 1) {
    const fullName = String(formData.get(`name-${index}`) ?? '').trim()
    if (!fullName) continue

    members.push({
      guestIndex: index,
      fullName,
      ...optional(formData, `birth-${index}`, 'birthDate'),
      ...optional(formData, `nationality-${index}`, 'nationality'),
      ...optional(formData, `docType-${index}`, 'documentType'),
      ...optional(formData, `docNumber-${index}`, 'documentNumber'),
    })
  }

  const outcome = await saveParty({
    propertyId: stay.propertyId,
    reservationId: stay.reservationId,
    members,
  })

  redirect(stayUrl(context, outcome.status === 'saved' ? '?saved=party' : '?error=party'))
}

/** One identity document (E2.1). */
export async function uploadDocument(context: Context, formData: FormData): Promise<void> {
  const resolved = await resolveStay(context.token)
  if (!resolved.ok) redirect(stayUrl(context))

  const { stay } = resolved

  const guestIndex = Number(formData.get('guestIndex'))
  const file = formData.get('document')

  if (!Number.isInteger(guestIndex) || guestIndex < 0 || !(file instanceof File)) {
    redirect(stayUrl(context, '?error=upload'))
  }

  // Bounded by the party size for the same reason the names are: an index from
  // a form is a suggestion, and one outside the booking would create a
  // registration record for a person the room cannot hold.
  if (guestIndex >= Math.max(1, stay.adults + stay.children)) {
    redirect(stayUrl(context, '?error=upload'))
  }

  const stored = await storeIdentityDocument({
    propertyId: stay.propertyId,
    reservationId: stay.reservationId,
    guestIndex,
    file: file as File,
  })

  if (stored.status !== 'stored') {
    redirect(stayUrl(context, '?error=upload'))
  }

  // The row is updated only after the object exists. The other order would
  // record a document path that points at nothing, and the first person to
  // find out would be whoever opened it at the desk.
  const recorded = await recordDocument({
    propertyId: stay.propertyId,
    reservationId: stay.reservationId,
    guestIndex,
    documentPath: stored.path,
  })

  redirect(stayUrl(context, recorded.status === 'recorded' ? '?saved=document' : '?error=upload'))
}

/** When they will arrive (E2.2). */
export async function submitArrivalTime(context: Context, formData: FormData): Promise<void> {
  const resolved = await resolveStay(context.token)
  if (!resolved.ok) redirect(stayUrl(context))

  const time = String(formData.get('time') ?? '')

  const outcome = await setExpectedArrival({
    propertyId: resolved.stay.propertyId,
    reservationId: resolved.stay.reservationId,
    time,
  })

  redirect(stayUrl(context, outcome.status === 'set' ? '?saved=arrival' : '?error=arrival'))
}

function optional(
  formData: FormData,
  field: string,
  key: 'birthDate' | 'nationality' | 'documentType' | 'documentNumber',
): Partial<PartyInput> {
  const value = String(formData.get(field) ?? '').trim()

  return value ? ({ [key]: value } as Partial<PartyInput>) : {}
}
