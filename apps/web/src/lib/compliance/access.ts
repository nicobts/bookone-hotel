import 'server-only'
import { notFound } from 'next/navigation'
import { ADAPTER_FEATURES } from '@bookone/core/compliance'
import { propertyFeatures, requireProperty } from '@/lib/auth/current-property'

/**
 * The compliance surfaces' gate (WP1.6, ADR-019).
 *
 * The dashboard belongs to no single module: it shows the filings of every
 * adapter the property has switched on. With none on, the property cannot
 * reach it (404), like any module it lacks. Each obligation is then checked
 * against its own adapter's feature where it is acted on.
 */
export async function requireCompliance(locale: string, slug: string) {
  const context = await requireProperty(locale, slug)
  const features = await propertyFeatures(context.property.id)
  const adapterIds = Object.entries(ADAPTER_FEATURES)
    .filter(([, feature]) => features.has(feature))
    .map(([adapterId]) => adapterId)
  if (adapterIds.length === 0) notFound()
  return { ...context, adapterIds }
}
