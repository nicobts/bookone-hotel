import 'server-only'
import { cookies } from 'next/headers'

/**
 * The guest's details, between step 3 and step 4.
 *
 * Steps 1 and 2 live in the URL because the search is the shareable part of a
 * booking link. A name, an email and a phone number are not: a guest forwarding
 * "here are the dates, can you pay?" should not be forwarding their own contact
 * details in the address bar, into the recipient's browser history and every
 * proxy in between.
 *
 * So this half lives in an httpOnly cookie scoped to the one reservation. It is
 * not signed, and does not need to be — the only thing a guest could achieve by
 * editing their own draft is changing their own name, which is what the form is
 * for. The trust boundary is at `confirmBooking`, which validates what it is
 * given regardless of where it came from.
 *
 * It expires with the hold. A draft that outlived the booking it belongs to is
 * personal data kept for no reason.
 */

export interface BookingDraft {
  name: string
  email: string
  phone?: string
  marketingConsent: boolean
}

const MAX_AGE_SECONDS = 35 * 60

function cookieName(reservationId: string): string {
  return `bo_draft_${reservationId}`
}

export async function saveDraft(reservationId: string, draft: BookingDraft): Promise<void> {
  const store = await cookies()

  store.set(cookieName(reservationId), JSON.stringify(draft), {
    httpOnly: true,
    sameSite: 'lax',
    // Secure everywhere but local development, where there is no TLS to be
    // secure over and the cookie would simply never be set.
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  })
}

export async function readDraft(reservationId: string): Promise<BookingDraft | null> {
  const store = await cookies()
  const raw = store.get(cookieName(reservationId))?.value

  if (!raw) return null

  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return null

    const record = parsed as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name : ''
    const email = typeof record.email === 'string' ? record.email : ''

    if (!name || !email) return null

    return {
      name,
      email,
      ...(typeof record.phone === 'string' && record.phone ? { phone: record.phone } : {}),
      marketingConsent: record.marketingConsent === true,
    }
  } catch {
    // A cookie we cannot read is a cookie we ignore. The guest is sent back to
    // step 3 to type it again, which is a mild annoyance; throwing here would
    // be a 500 on a booking page.
    return null
  }
}

/** Cleared as soon as the booking is confirmed — the row holds it now. */
export async function clearDraft(reservationId: string): Promise<void> {
  const store = await cookies()
  store.delete(cookieName(reservationId))
}
