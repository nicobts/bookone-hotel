'use server'

import { redirect } from 'next/navigation'
import { getBookingProperty } from '@bookone/core/db'
import {
  confirmBooking,
  createHold,
  requestBooking,
  searchAvailability,
} from '@bookone/core/booking'
import { clearDraft, readDraft, saveDraft } from '@/lib/booking/draft'
import { searchToQuery, type BookingSearch } from '@/lib/booking/params'
import { notifyBookingConfirmed } from '@/lib/worker'

/**
 * The booking flow's writes.
 *
 * Every one of them starts by resolving the property from the slug in the URL
 * and re-reading what it needs from the database. Nothing trusts a hidden
 * field: this is a public form, and a hidden input is a suggestion from a
 * stranger. Prices in particular are re-derived from `rate_snapshots` rather
 * than accepted from the request — a posted total is a total anybody can set to
 * zero.
 */

interface Context {
  locale: string
  slug: string
}

/** Step 2 → 3. Prices the stay again, writes the hold, moves the guest on. */
export async function selectRoom(context: Context, formData: FormData): Promise<void> {
  const property = await getBookingProperty(context.slug)
  if (!property) redirect(`/${context.locale}`)

  const search = readSearch(formData)
  const roomTypeId = String(formData.get('roomTypeId') ?? '')

  if (!search || !roomTypeId) {
    redirect(`/${context.locale}/book/${context.slug}`)
  }

  // Re-run the search rather than trusting the posted price. It also re-checks
  // freshness: a cache that went stale while the guest was choosing must not
  // produce a hold at a price no source stands behind any more.
  const outcome = await searchAvailability({
    propertyId: property.id,
    arrival: search.arrival,
    departure: search.departure,
    adults: search.adults,
    children: search.children,
  })

  if (outcome.status !== 'ok') {
    redirect(`/${context.locale}/book/${context.slug}?${searchToQuery(search)}`)
  }

  const option = outcome.options.find((candidate) => candidate.roomTypeId === roomTypeId)

  if (!option) {
    // The room stopped being available between rendering and choosing. Back to
    // the list, which now shows what is actually there.
    redirect(`/${context.locale}/book/${context.slug}?${searchToQuery(search)}`)
  }

  const hold = await createHold({
    propertyId: property.id,
    roomTypeId: option.roomTypeId,
    arrival: search.arrival,
    departure: search.departure,
    adults: search.adults,
    children: search.children,
    nights: option.quote.nights.map((night, index) => ({
      date: night.date,
      priceCents: night.priceCents,
      currency: option.quote.currency,
      snapshotId: option.quote.snapshotIds[index] ?? '',
    })),
  })

  if (hold.status !== 'held') {
    redirect(`/${context.locale}/book/${context.slug}?${searchToQuery(search)}&error=hold`)
  }

  redirect(
    `/${context.locale}/book/${context.slug}?${searchToQuery(search, { hold: hold.reservationId })}`,
  )
}

/** Step 3 → 4. The details go into a cookie, not the URL and not yet a row. */
export async function saveDetails(context: Context, formData: FormData): Promise<void> {
  const search = readSearch(formData)
  const reservationId = String(formData.get('hold') ?? '')

  if (!search || !reservationId) {
    redirect(`/${context.locale}/book/${context.slug}`)
  }

  const name = String(formData.get('name') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const phone = String(formData.get('phone') ?? '').trim()

  const query = searchToQuery(search, { hold: reservationId })

  if (!name || !email.includes('@')) {
    redirect(`/${context.locale}/book/${context.slug}?${query}&error=details`)
  }

  await saveDraft(reservationId, {
    name,
    email,
    ...(phone ? { phone } : {}),
    marketingConsent: formData.get('marketingConsent') === 'on',
  })

  redirect(`/${context.locale}/book/${context.slug}?${query}&step=review`)
}

/**
 * Step 4. The commitment.
 *
 * Note the order: the booking is confirmed and the confirmation queued in one
 * transaction inside `confirmBooking`, and only then is the worker told. If
 * that last call fails the guest still has a booking, the hotel still gets it
 * (the exceptions inbox surfaces an unreflected reservation after sixty
 * seconds), and the confirmation still goes out (the sweep finds the queued
 * row). The nudge is the fast path, not the mechanism.
 */
export async function confirm(context: Context, formData: FormData): Promise<void> {
  const property = await getBookingProperty(context.slug)
  if (!property) redirect(`/${context.locale}`)

  const search = readSearch(formData)
  const reservationId = String(formData.get('hold') ?? '')

  if (!search || !reservationId) {
    redirect(`/${context.locale}/book/${context.slug}`)
  }

  const draft = await readDraft(reservationId)
  const query = searchToQuery(search, { hold: reservationId })

  if (!draft) {
    // The cookie expired or was never set. Back to step 3 rather than an error:
    // the hold is still good and the guest only has to retype a name.
    redirect(`/${context.locale}/book/${context.slug}?${query}`)
  }

  const outcome = await confirmBooking({
    propertyId: property.id,
    reservationId,
    guest: {
      name: draft.name,
      email: draft.email,
      ...(draft.phone ? { phone: draft.phone } : {}),
      locale: context.locale,
      marketingConsent: draft.marketingConsent,
    },
  })

  if (outcome.status === 'expired') {
    redirect(`/${context.locale}/book/${context.slug}?${query}&step=review&error=expired`)
  }

  if (outcome.status === 'rejected') {
    redirect(`/${context.locale}/book/${context.slug}?${query}&step=review&error=confirm`)
  }

  await notifyBookingConfirmed({
    propertyId: property.id,
    reservationId: outcome.reservationId,
    notificationId: outcome.status === 'confirmed' ? outcome.notificationId : null,
  })

  // The draft has done its job; the reservation and the guest row hold it now.
  await clearDraft(reservationId)

  redirect(`/${context.locale}/book/${context.slug}?booked=${outcome.reservationId}`)
}

/** The stale-source fallback (E1.1). Creates no reservation — there is none. */
export async function sendRequest(context: Context, formData: FormData): Promise<void> {
  const property = await getBookingProperty(context.slug)
  if (!property) redirect(`/${context.locale}`)

  const search = readSearch(formData)
  if (!search) redirect(`/${context.locale}/book/${context.slug}`)

  const name = String(formData.get('name') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const phone = String(formData.get('phone') ?? '').trim()
  const message = String(formData.get('message') ?? '').trim()

  const query = searchToQuery(search)

  const outcome = await requestBooking({
    propertyId: property.id,
    guestName: name,
    guestEmail: email,
    ...(phone ? { guestPhone: phone } : {}),
    arrivalDate: search.arrival,
    departureDate: search.departure,
    adults: search.adults,
    children: search.children,
    ...(message ? { message } : {}),
  })

  if (outcome.status === 'sent') {
    redirect(`/${context.locale}/book/${context.slug}?${query}&requested=1`)
  }

  redirect(`/${context.locale}/book/${context.slug}?${query}&error=${outcome.status}`)
}

/**
 * The search, read back off the form.
 *
 * Re-validated even though the same values were validated on the way in: a form
 * post is a new request from an untrusted client, and "we checked it last time"
 * is not a property of anything that arrives over the network.
 */
function readSearch(formData: FormData): BookingSearch | null {
  const arrival = String(formData.get('arrival') ?? '')
  const departure = String(formData.get('departure') ?? '')

  if (!/^\d{4}-\d{2}-\d{2}$/.test(arrival) || !/^\d{4}-\d{2}-\d{2}$/.test(departure)) return null
  if (departure <= arrival) return null

  const adults = Number(formData.get('adults'))
  const children = Number(formData.get('children'))

  if (!Number.isInteger(adults) || adults < 1 || adults > 8) return null
  if (!Number.isInteger(children) || children < 0 || children > 8) return null

  return { arrival, departure, adults, children }
}
