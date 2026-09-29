import { getObligationDetail } from '@bookone/core/compliance'
import { requireCompliance } from '@/lib/compliance/access'
import { signedReceiptUrl } from '@/lib/storage'

/**
 * The receipt file recorded with a manual filing (WP1.6), through a signed
 * URL valid for two minutes. Checked here as its own request: membership, a
 * compliance module, the obligation read under the member's session (RLS) and
 * its own adapter's feature. The path is the one the database holds, never
 * one from the request.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string; property: string; obligation: string }> },
) {
  const { locale, property: slug, obligation: obligationId } = await params
  const { user, property, adapterIds } = await requireCompliance(locale, slug)

  const obligation = await getObligationDetail(user.id, property.id, obligationId)
  const attachment = obligation?.attachment
  if (
    !obligation ||
    !adapterIds.includes(obligation.adapterId) ||
    !attachment ||
    attachment.deletedAt
  ) {
    return new Response('Not found', { status: 404 })
  }

  const url = await signedReceiptUrl(attachment.path)
  if (!url) return new Response('Storage unavailable', { status: 503 })

  return new Response(null, {
    status: 303,
    headers: { location: url, 'cache-control': 'no-store, private' },
  })
}
