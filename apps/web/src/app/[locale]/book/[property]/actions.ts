'use server'

import { redirect } from 'next/navigation'
import { getBookingProperty, getHeldBooking } from '@bookone/core/db'
import {
  attachGuest,
  confirmReservation,
  createHold,
  requestBooking,
  searchAvailability,
} from '@bookone/core/booking'
import { computeDeposit, readBookingPolicy } from '@bookone/core/policy'
import { clearDraft, readDraft, saveDraft } from '@/lib/booking/draft'
import { searchToQuery, type BookingSearch } from '@/lib/booking/params'
import { notifyBookingConfirmed, requestCancellation, startCheckout } from '@/lib/worker'

/**
 * The booking flow's writes.
 *
 * Every one of them starts by resolving the property from the slug in the URL
 * and re-reading what it needs from the database. Nothing trusts a hidden
 * field: this is a public form, and a hidden input is a suggestion from a
 * stranger. Prices and deposits in particular are re-derived rather than
 * accepted from the request — a posted total is a total anybody can set to
 * zero, and a posted deposit is a charge anybody can remove.
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
 * Three steps, in an order that matters:
 *
 *   1. **Attach the guest** — before any payment, because the webhook that
 *      confirms a paid booking has never seen the guest's details: they live in
 *      a cookie on their browser. Putting them on the payment intent's metadata
 *      instead would hand a third party a name and an email for no reason.
 *   2. **Take a deposit, if the property asks for one.** The guest leaves for
 *      the provider and the booking stays a hold. Nothing here confirms it —
 *      the provider's webhook does (03 §7.2).
 *   3. **Otherwise confirm directly**, which is the whole path for a property
 *      that takes no deposit.
 *
 * MEMO: the provider today is a simulated adapter that moves no money
 * (ADR-010). This function does not know that and does not need to, which is
 * exactly the property that makes the real integration a swap and not a
 * rewrite.
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

  const attached = await attachGuest({
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

  if (attached.status === 'expired') {
    redirect(`/${context.locale}/book/${context.slug}?${query}&step=review&error=expired`)
  }

  if (attached.status === 'rejected') {
    redirect(`/${context.locale}/book/${context.slug}?${query}&step=review&error=confirm`)
  }

  const booking = await getHeldBooking(property.id, reservationId)

  // Recomputed from the row rather than read from the form. The deposit decides
  // whether money is taken, and a hidden field deciding that is a hidden field
  // worth editing.
  const deposit = computeDeposit(readBookingPolicy(property.settings), {
    totalCents: booking?.totalCents ?? 0,
    nightCount: countNights(search.arrival, search.departure),
  })

  if (deposit.dueNowCents > 0) {
    const checkout = await startCheckout({
      propertyId: property.id,
      reservationId,
      returnUrl: `${appUrl()}/${context.locale}/book/${context.slug}?booked=${reservationId}`,
    })

    if (checkout.checkoutUrl) redirect(checkout.checkoutUrl)

    if (checkout.status === 'rejected') {
      redirect(`/${context.locale}/book/${context.slug}?${query}&step=review&error=payment`)
    }

    // `no-payment-required` from the worker while we computed a deposit means
    // the two disagree — the property's policy changed mid-booking. The
    // worker's answer wins: it is the one that would have taken the money.
  }

  const outcome = await confirmReservation({ propertyId: property.id, reservationId })

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

/**
 * Cancel, from the manage page (E1.4).
 *
 * The refund was shown before the guest pressed the button — that is the
 * acceptance criterion, and `quoteCancellation` on the page is what satisfies
 * it. Nothing about the amount travels in this form: the worker recomputes it,
 * because a refund figure posted from a browser is a refund figure anyone can
 * raise.
 *
 * Routed through the worker because refunding needs the payment provider, and
 * that lives in exactly one process.
 */
export async function cancel(
  context: Context & { reservationId: string },
  _formData: FormData,
): Promise<void> {
  const property = await getBookingProperty(context.slug)
  if (!property) redirect(`/${context.locale}`)

  const manageUrl = `/${context.locale}/book/${context.slug}/manage/${context.reservationId}`

  const result = await requestCancellation({
    propertyId: property.id,
    reservationId: context.reservationId,
  })

  if (result.status !== 'cancelled') redirect(`${manageUrl}?error=cancel`)

  redirect(`${manageUrl}?cancelled=1${result.refundFailed ? '&refund=failed' : ''}`)
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

/** The public origin, for the return URL the provider sends the guest back to. */
function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? 'http://localhost:3000'
}

function countNights(arrival: string, departure: string): number {
  const start = Date.parse(`${arrival}T00:00:00Z`)
  const end = Date.parse(`${departure}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0

  return Math.round((end - start) / 86_400_000)
}
