import {
  ALLOGGIATI_ADAPTER_ID,
  ManualFallbackUnavailable,
  alloggiatiManualFallback,
  getObligationForMember,
  noteFallbackDownloaded,
} from '@bookone/core/compliance'
import { requireFeature } from '@/lib/auth/current-property'

/**
 * The manual fallback for one obligation, as a download (ADR-026, WP1.1).
 *
 * What a receptionist uploads to the authority's portal by hand when the
 * automatic filing cannot be made in time: the exact file the adapter would
 * have sent. Any member may take it — filing is desk work — and each download
 * is in the event log, because the file carries the party's identity details.
 *
 * Checked here, as its own request: the feature, membership (`requireFeature`),
 * and the obligation read under the member's session, so another property's id
 * is a 404 like one that does not exist.
 *
 * Only Alloggiati has an implementation today; the others arrive with their
 * adapters (WP1.3, WP1.4) and answer 404 until then.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string; property: string; obligation: string }> },
) {
  const { locale, property: slug, obligation: obligationId } = await params
  const { user, property } = await requireFeature(locale, slug, 'alloggiati')

  const obligation = await getObligationForMember(user.id, property.id, obligationId)
  if (!obligation || obligation.adapterId !== ALLOGGIATI_ADAPTER_ID || !obligation.reservationId) {
    return new Response('Not found', { status: 404 })
  }

  let fallback
  try {
    fallback = await alloggiatiManualFallback({
      propertyId: property.id,
      reservationId: obligation.reservationId,
    })
  } catch (error) {
    if (error instanceof ManualFallbackUnavailable) {
      return new Response(`Not ready: ${error.reasons.join('; ')}`, { status: 409 })
    }
    throw error
  }

  await noteFallbackDownloaded({ propertyId: property.id, obligationId, userId: user.id })

  return new Response(fallback.content, {
    headers: {
      'content-type': `${fallback.contentType}; charset=utf-8`,
      'content-disposition': `attachment; filename="${fallback.filename}"`,
      // Identity details: never cached anywhere.
      'cache-control': 'no-store, no-cache, must-revalidate, private',
    },
  })
}
