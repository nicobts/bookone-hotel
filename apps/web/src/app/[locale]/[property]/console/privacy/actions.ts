'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { flash } from '@bookone/ui/lib/flash-server'
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

function strings(context: Context) {
  return getTranslations({ locale: context.locale, namespace: 'console.privacy' })
}

async function unknownGuest(context: Context): Promise<never> {
  await flash.error((await strings(context))('unknownGuest'))
  redirect(`/${context.slug}/console/privacy`)
}

export type ExportStart = { ok: true; url: string } | { ok: false; message: string }

/**
 * Opens an export request and hands back the download address.
 *
 * Two steps, deliberately: the bundle is generated on demand and never
 * stored, so there is no artefact for a later "download" button to point at.
 * Recording the request first means the row exists even if the download is
 * abandoned, which is the honest order — the obligation started when the guest
 * asked, not when a file was produced.
 *
 * Returned rather than redirected to. A server action that redirects to a file
 * never finishes navigating — the browser downloads and stays put — so the
 * button that started it would wait forever. The client starts the download
 * (`ExportDataButton`) and says so.
 */
export async function requestExport(context: Context & { guestId: string }): Promise<ExportStart> {
  const { user, property } = await requireOwner(context.locale, context.slug)
  const t = await strings(context)

  const subject = await getSubject(property.id, context.guestId)
  if (!subject) return { ok: false, message: t('unknownGuest') }

  await raiseRequest({
    propertyId: property.id,
    guestId: context.guestId,
    kind: 'export',
    requestedBy: user.id,
  })

  revalidatePath(`/${context.locale}/${context.slug}/console/privacy`)
  return {
    ok: true,
    url: `/${context.locale}/${context.slug}/console/privacy/export/${context.guestId}`,
  }
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
  if (!subject) return unknownGuest(context)

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
   * `queued` versus `pending`, and the difference is not cosmetic.
   *
   * If the worker is unreachable the request row still exists and still has its
   * deadline — the obligation does not depend on our queue being up. What the
   * owner must not be told is that the erasure is running when nothing picked
   * it up, so the desk says "recorded, not yet applied" (a warning, which stays
   * on screen longer) and the runbook says how to run it by hand. The open
   * request stays listed on the page either way.
   */
  const t = await strings(context)
  if (enqueued) await flash.success(t('toast.erasureQueued'), t('erasureQueued'))
  else await flash.warning(t('toast.erasurePending'), t('erasurePending'))
  redirect(`/${context.slug}/console/privacy`)
}
