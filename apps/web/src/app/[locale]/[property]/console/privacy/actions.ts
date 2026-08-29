'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { raiseRequest, getSubject } from '@bookone/core/privacy'
import { requireOwner } from '@/lib/auth/current-property'
import { requestErasure } from '@/lib/worker'

/**
 * The data-subject request desk (E8.1).
 *
 * `requireOwner` in every action rather than inherited from the page: an action
 * is its own request, and the form that posts to it is a string in somebody's
 * browser. Owner rather than member because a privacy request records that a
 * named guest asked to be forgotten, which is a fact about a person the
 * receptionist who checked them in has no reason to hold — and the RLS policy
 * says the same thing at the database (`privacy_requests_select`).
 */

interface Context {
  locale: string
  slug: string
}

/**
 * Opens an export request and sends the owner to the download.
 *
 * Two steps in one action, deliberately: the bundle is generated on demand and
 * never stored, so there is no artefact for a later "download" button to point
 * at. Recording the request first means the row exists even if the download is
 * abandoned, which is the honest order — the obligation started when the guest
 * asked, not when a file was produced.
 */
export async function requestExport(context: Context, formData: FormData): Promise<void> {
  const { user, property } = await requireOwner(context.locale, context.slug)
  const guestId = String(formData.get('guestId') ?? '')

  const subject = await getSubject(property.id, guestId)
  if (!subject) redirect(`/${context.slug}/console/privacy?error=unknown-guest`)

  await raiseRequest({
    propertyId: property.id,
    guestId,
    kind: 'export',
    requestedBy: user.id,
  })

  revalidatePath(`/${context.locale}/${context.slug}/console/privacy`)
  redirect(`/${context.slug}/console/privacy/export/${guestId}`)
}

/**
 * Applies an erasure, after the confirmation screen has shown the carve-outs.
 *
 * The request row is written here and resolved by the worker when the erasure
 * finishes. Two steps, visible as two states on the desk, because the operation
 * is irreversible against a person's data and the owner pressing it is doing it
 * for the first time (design-notes/privacy.md §4B).
 */
export async function applyErasure(context: Context, formData: FormData): Promise<void> {
  const { user, property } = await requireOwner(context.locale, context.slug)
  const guestId = String(formData.get('guestId') ?? '')

  const subject = await getSubject(property.id, guestId)
  if (!subject) redirect(`/${context.slug}/console/privacy?error=unknown-guest`)

  const requestId = await raiseRequest({
    propertyId: property.id,
    guestId,
    kind: 'erasure',
    requestedBy: user.id,
  })

  const enqueued = await requestErasure({
    propertyId: property.id,
    guestId,
    requestId,
    userId: user.id,
  })

  revalidatePath(`/${context.locale}/${context.slug}/console/privacy`)

  /*
   * `queued` versus `pending` in the URL, and the difference is not cosmetic.
   *
   * If the worker is unreachable the request row still exists and still has its
   * deadline — the obligation does not depend on our queue being up. What the
   * owner must not be told is that the erasure is running when nothing picked
   * it up, so the desk says "recorded, not yet applied" and the runbook says
   * how to run it by hand.
   */
  redirect(`/${context.slug}/console/privacy?erased=${enqueued ? 'queued' : 'pending'}`)
}
