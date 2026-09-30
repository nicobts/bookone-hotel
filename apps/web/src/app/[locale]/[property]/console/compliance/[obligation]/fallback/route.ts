import {
  ADAPTER_FEATURES,
  ManualFallbackUnavailable,
  getObligationForMember,
  noteFallbackDownloaded,
  type ManualFallback,
} from '@bookone/core/compliance'
import { hasFeature, requireProperty } from '@/lib/auth/current-property'
import { buildManualFallback } from '@/lib/compliance/fallback'

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
 * Alloggiati's file for a stay, WebTur's for a day (WP1.3). The tourist-tax
 * declaration has no obligation yet (WP1.4) and answers 404.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string; property: string; obligation: string }> },
) {
  const { locale, property: slug, obligation: obligationId } = await params
  const { user, property } = await requireProperty(locale, slug)

  const obligation = await getObligationForMember(user.id, property.id, obligationId)
  // The adapter's own feature (ADR-019): off, the property cannot reach it.
  const feature = obligation ? ADAPTER_FEATURES[obligation.adapterId] : undefined
  if (!obligation || !feature || !(await hasFeature(property.id, feature))) {
    return new Response('Not found', { status: 404 })
  }

  let fallback: ManualFallback | null
  try {
    fallback = await buildManualFallback(property.id, obligation)
  } catch (error) {
    if (error instanceof ManualFallbackUnavailable) {
      return new Response(`Not ready: ${error.reasons.join('; ')}`, { status: 409 })
    }
    throw error
  }
  if (!fallback) return new Response('Not found', { status: 404 })

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
