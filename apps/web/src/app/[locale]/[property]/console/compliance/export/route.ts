import { inspectionCsv, inspectionExport, noteInspectionExported } from '@bookone/core/compliance'
import { requireCompliance } from '@/lib/compliance/access'

const DATE = /^\d{4}-\d{2}-\d{2}$/
/** A year at most: an inspection names a period, not the property's history. */
const MAX_DAYS = 366

/**
 * The inspection export for a period (WP1.6): every filing owed in it, in the
 * property's own days, with its receipt and fingerprint, as semicolon CSV.
 *
 * Any member may take it, like the fallback file: the desk is who an officer
 * asks. Each export is in the event log with its period, because it lists
 * booking references and receipts. Only the modules the property has.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ locale: string; property: string }> },
) {
  const { locale, property: slug } = await params
  const { user, property, adapterIds } = await requireCompliance(locale, slug)

  const url = new URL(request.url)
  const from = url.searchParams.get('from') ?? ''
  const to = url.searchParams.get('to') ?? ''
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000
  if (!DATE.test(from) || !DATE.test(to) || !(days >= 0 && days < MAX_DAYS)) {
    return new Response('A period of at most a year, from and to as YYYY-MM-DD', { status: 400 })
  }

  const data = await inspectionExport(user.id, property.id, {
    from,
    to,
    timeZone: property.timezone,
    adapterIds,
  })
  await noteInspectionExported({
    propertyId: property.id,
    userId: user.id,
    from,
    to,
    rows: data.rows.length,
  })

  return new Response(inspectionCsv(data), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="adempimenti-${slug}-${from}-${to}.csv"`,
      'cache-control': 'no-store, no-cache, must-revalidate, private',
    },
  })
}
