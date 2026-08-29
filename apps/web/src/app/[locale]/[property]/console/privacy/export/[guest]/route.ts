import { buildGuestExport } from '@bookone/core/privacy'
import { requireOwner } from '@/lib/auth/current-property'

/**
 * The subject access bundle, as a download (E8.1, Art. 15 and Art. 20).
 *
 * ## Generated on demand, never stored
 *
 * There is no bucket and no signed link. A stored bundle is a copy of
 * everything we hold about one person, sitting somewhere, being the
 * highest-value object in the system — which is the shape of every "the export
 * feature caused the breach" incident. This route builds it, streams it, and
 * forgets it.
 *
 * ## JSON and no PDF
 *
 * Art. 20 asks for a structured, commonly used, machine-readable format. JSON
 * is that. A rendered report would be a second surface to keep truthful as the
 * schema moves, and the plain-language part is in the manifest where a person
 * will actually read it.
 *
 * ## Owner-only, checked here
 *
 * A route handler is its own request. `requireOwner` 404s for staff and for
 * anybody who is not a member — the same answer, because "this exists and you
 * may not see it" is more than a URL needs to give away.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string; property: string; guest: string }> },
) {
  const { locale, property: slug, guest } = await params

  const { property } = await requireOwner(locale, slug)

  let bundle: Awaited<ReturnType<typeof buildGuestExport>>

  try {
    bundle = await buildGuestExport({ propertyId: property.id, guestId: guest })
  } catch {
    // The only failure `buildGuestExport` raises is a guest that is not this
    // property's. Same answer as a guest that does not exist, deliberately:
    // otherwise this endpoint reports whether a given id belongs to somebody
    // else's hotel.
    return new Response('Not found', { status: 404 })
  }

  /*
   * A filename with the property slug and the date, and the guest id rather
   * than their name.
   *
   * The name would be more readable and would also put a person's name in a
   * file that gets forwarded, saved to a shared drive and attached to an email
   * thread. The id is inside the bundle anyway and the covering response names
   * the person.
   */
  const filename = `${slug}-subject-access-${guest}.json`

  return new Response(JSON.stringify(bundle, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      // Never cached, anywhere. This is the most sensitive payload the console
      // ever returns and a CDN copy of it would outlive the request by hours.
      'cache-control': 'no-store, no-cache, must-revalidate, private',
    },
  })
}
