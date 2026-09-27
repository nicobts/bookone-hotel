'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { flash } from '@bookone/ui/lib/flash-server'
import {
  hasDocumentConsent,
  recordDocument,
  recordDocumentConsent,
  resolveStay,
  saveParty,
  setExpectedArrival,
  type PartyInput,
} from '@bookone/core/journey'
import { storeIdentityDocument } from '@/lib/storage'
import {
  confirmArrival,
  confirmCheckout,
  requestDocumentExtraction,
  sendGuestMessage,
} from '@/lib/worker'
import { hasFeature } from '@/lib/auth/current-property'

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
 *
 * Outcomes are flashed as toasts (`@bookone/ui/lib/flash`), and every write
 * revalidates before redirecting back: the target is the page the guest is
 * already on, and without it the client router can serve its cached copy of
 * that URL — the stale page `sendMessage` below describes.
 */

interface Context {
  locale: string
  token: string
}

/**
 * The version of the guest privacy notice shown beside the upload, recorded
 * with each consent so a later wording change does not rewrite what an earlier
 * guest agreed to. Bump it whenever the `stay.privacy.*` strings change.
 */
const GUEST_NOTICE_VERSION = 'guest-notice-2026-09-27-draft'

function stayUrl(context: Context, extra = ''): string {
  return `/${context.locale}/stay/${context.token}${extra}`
}

function strings(context: Context) {
  return getTranslations({ locale: context.locale, namespace: 'stay' })
}

/** Revalidate, then back to the page (and section) the guest came from. */
function back(context: Context, hash = ''): never {
  revalidatePath(stayUrl(context))
  redirect(stayUrl(context, hash))
}

async function failed(
  context: Context,
  key: 'upload' | 'consent' | 'message' | 'generic',
  hash = '',
) {
  await flash.error((await strings(context))(`errors.${key}`))
  return back(context, hash)
}

/** Who is travelling (E2.1). Upserts by index, so resubmitting is safe. */
export async function submitParty(context: Context, formData: FormData): Promise<void> {
  const resolved = await resolveStay(context.token)
  if (!resolved.ok) redirect(stayUrl(context))
  // The section is not on the page without the feature; the action refuses too (ADR-019).
  if (!(await hasFeature(resolved.stay.propertyId, 'prearrival'))) redirect(stayUrl(context))

  const { stay } = resolved

  // The party size comes from the reservation, not the form. A guest cannot
  // register eight people into a double room by editing a hidden field, and the
  // number of people in the room is a fact the booking already settled.
  const size = Math.max(1, stay.adults + stay.children)

  const members: PartyInput[] = []

  for (let index = 0; index < size; index += 1) {
    const surname = String(formData.get(`surname-${index}`) ?? '').trim()
    const givenName = String(formData.get(`given-${index}`) ?? '').trim()

    // A person needs both halves to be filed at all. One without the other is
    // an incomplete row, not half a guest — skipping keeps the form resumable
    // and the console tells the owner exactly who is still missing.
    if (!surname || !givenName) continue

    const sex = String(formData.get(`sex-${index}`) ?? '')

    members.push({
      guestIndex: index,
      surname,
      givenName,
      ...(sex === 'm' || sex === 'f' ? { sex } : {}),
      ...optional(formData, `birth-${index}`, 'birthDate'),
      ...optional(formData, `birthPlace-${index}`, 'birthPlace'),
      ...optional(formData, `birthCountry-${index}`, 'birthCountry'),
      ...optional(formData, `citizenship-${index}`, 'citizenship'),
      ...optional(formData, `docType-${index}`, 'documentType'),
      ...optional(formData, `docNumber-${index}`, 'documentNumber'),
      ...optional(formData, `docIssuer-${index}`, 'documentIssuer'),
    })
  }

  const outcome = await saveParty({
    propertyId: stay.propertyId,
    reservationId: stay.reservationId,
    members,
  })

  if (outcome.status !== 'saved') return failed(context, 'generic')
  await flash.success((await strings(context))('toast.partySaved'))
  back(context)
}

/** One identity document (E2.1). */
export async function uploadDocument(context: Context, formData: FormData): Promise<void> {
  const resolved = await resolveStay(context.token)
  if (!resolved.ok) redirect(stayUrl(context))
  // The section is not on the page without the feature; the action refuses too (ADR-019).
  if (!(await hasFeature(resolved.stay.propertyId, 'prearrival'))) redirect(stayUrl(context))

  const { stay } = resolved

  // Consent before the first document (WP0.4). The checkbox is `required` in
  // the form; this is the check that holds when the form is not the one we sent.
  if (!(await hasDocumentConsent(stay.propertyId, stay.reservationId))) {
    if (formData.get('consent') !== 'on') return failed(context, 'consent')
    await recordDocumentConsent({
      propertyId: stay.propertyId,
      reservationId: stay.reservationId,
      noticeVersion: GUEST_NOTICE_VERSION,
    })
  }

  const guestIndex = Number(formData.get('guestIndex'))
  const file = formData.get('document')

  if (!Number.isInteger(guestIndex) || guestIndex < 0 || !(file instanceof File)) {
    return failed(context, 'upload')
  }

  // Bounded by the party size for the same reason the names are: an index from
  // a form is a suggestion, and one outside the booking would create a
  // registration record for a person the room cannot hold.
  if (guestIndex >= Math.max(1, stay.adults + stay.children)) {
    return failed(context, 'upload')
  }

  const stored = await storeIdentityDocument({
    propertyId: stay.propertyId,
    reservationId: stay.reservationId,
    guestIndex,
    file: file as File,
  })

  if (stored.status !== 'stored') {
    return failed(context, 'upload')
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

  // Read it with the vision model where the property has `document_ocr`
  // (WP0.4). Best effort and asynchronous: the api answers 404 without the
  // feature, and the guest is not kept waiting for a model.
  if (recorded.status === 'recorded') {
    await requestDocumentExtraction({
      propertyId: stay.propertyId,
      reservationId: stay.reservationId,
      guestIndex,
    })
  }

  if (recorded.status !== 'recorded') return failed(context, 'upload')
  const t = await strings(context)
  await flash.success(t('toast.documentSaved'), t('toast.documentSavedDescription'))
  back(context)
}

/** When they will arrive (E2.2). */
export async function submitArrivalTime(context: Context, formData: FormData): Promise<void> {
  const resolved = await resolveStay(context.token)
  if (!resolved.ok) redirect(stayUrl(context))
  // The section is not on the page without the feature; the action refuses too (ADR-019).
  if (!(await hasFeature(resolved.stay.propertyId, 'prearrival'))) redirect(stayUrl(context))

  const time = String(formData.get('time') ?? '')

  const outcome = await setExpectedArrival({
    propertyId: resolved.stay.propertyId,
    reservationId: resolved.stay.reservationId,
    time,
  })

  if (outcome.status !== 'set') return failed(context, 'generic')
  const t = await strings(context)
  await flash.success(t('toast.arrivalSaved'), t('arrival.saved', { time }))
  back(context)
}

type OptionalField =
  | 'birthDate'
  | 'birthPlace'
  | 'birthCountry'
  | 'citizenship'
  | 'documentType'
  | 'documentNumber'
  | 'documentIssuer'

function optional(formData: FormData, field: string, key: OptionalField): Partial<PartyInput> {
  const value = String(formData.get(field) ?? '').trim()

  return value ? ({ [key]: value } as Partial<PartyInput>) : {}
}

/**
 * The guest says they have arrived (E3.1).
 *
 * One of three trigger sources for the same journey command — this one, a staff
 * tap in the console, and a door event from Rooms when that exists. None is
 * privileged; the source is carried so G1 can count the arrivals that needed
 * nobody at a desk.
 *
 * Only offered on the day, which the page decides. Confirming an arrival two
 * days early would file the party with the registry before they were anywhere
 * near the building.
 */
export async function confirmArrivalNow(context: Context): Promise<void> {
  const resolved = await resolveStay(context.token)
  if (!resolved.ok) redirect(stayUrl(context))

  const { stay } = resolved

  const sent = await confirmArrival({
    propertyId: stay.propertyId,
    reservationId: stay.reservationId,
    source: 'guest',
  })

  if (!sent) return failed(context, 'generic')
  await flash.success((await strings(context))('arrived.done'))
  back(context)
}

/**
 * The guest wrote something (E3.2).
 *
 * The only write on this surface that is *not* best-effort. Everything else
 * here commits before the worker is nudged, so a worker that is down costs a
 * few seconds; a message that never reached the worker was never stored at all,
 * and telling the guest it was sent would be false. So this one reports the
 * failure.
 */
export async function sendMessage(context: Context, formData: FormData): Promise<void> {
  const resolved = await resolveStay(context.token)
  if (!resolved.ok) redirect(stayUrl(context))
  // The section is not on the page without the feature; the action refuses too (ADR-019).
  if (!(await hasFeature(resolved.stay.propertyId, 'inbox'))) redirect(stayUrl(context))

  const { stay } = resolved
  const message = String(formData.get('message') ?? '').trim()

  if (!message) redirect(stayUrl(context, '#messages'))

  const intent = formData.get('intent') === 'request' ? ('request' as const) : undefined

  const sent = await sendGuestMessage({
    propertyId: stay.propertyId,
    reservationId: stay.reservationId,
    locale: context.locale,
    message,
    ...(intent ? { intent } : {}),
  })

  /*
   * Revalidate before redirecting, because the redirect target is the page we
   * are already on.
   *
   * Found by sending the first message on a fresh page: the client router had
   * an RSC entry for this exact URL from the initial load — when the thread did
   * not exist — and served it. The guest pressed send and the thread still read
   * "no messages yet", which is the single worst moment for this surface to look
   * broken: the very first message anybody sends.
   *
   * The later messages looked fine, which is what made it easy to miss.
   */
  if (!sent.ok) return failed(context, 'message', '#messages')
  await flash.success((await strings(context))('toast.messageSent'))
  back(context, '#messages')
}

/**
 * The guest is leaving (E4.1).
 *
 * MEMO — no payment provider is connected, so nothing here moves money
 * (ADR-010). What it does do is real: it moves the journey to `settled`,
 * records any invoice request, and sends the review link afterwards.
 *
 * We issue no invoice. `billTo` is routed to the property, who issue the
 * fattura through their own certified chain (D11, binding rule 6).
 */
export async function checkOut(context: Context, formData: FormData): Promise<void> {
  const resolved = await resolveStay(context.token)
  if (!resolved.ok) redirect(stayUrl(context))

  const { stay } = resolved
  const billTo = String(formData.get('billTo') ?? '').trim()
  const taxId = String(formData.get('taxId') ?? '').trim()
  const address = String(formData.get('address') ?? '').trim()

  await confirmCheckout({
    propertyId: stay.propertyId,
    reservationId: stay.reservationId,
    ...(billTo ? { billTo } : {}),
    ...(billTo && (taxId || address)
      ? {
          details: {
            ...(taxId ? { taxId } : {}),
            ...(address ? { address } : {}),
          },
        }
      : {}),
  })

  await flash.success((await strings(context))('checkout.done'))
  back(context, '#checkout')
}
