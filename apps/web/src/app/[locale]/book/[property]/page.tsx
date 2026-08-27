import { setRequestLocale } from 'next-intl/server'

/**
 * Guest booking surface — public, per property, themed (PRD A1–A3).
 *
 * First platform-authoritative domain (D12): a reservation is born here with
 * its own UUID and `origin='platform'` before any external call, then reflects
 * to the PMS through the adapter. Availability is read-only display from
 * `rate_snapshots` and every price carries its `sourceSnapshotId`; on connector
 * failure this surface shows a request form, never a wrong availability.
 *
 * Built in Sprint 3. Reference implementation per ADR-014 is named in the
 * design note before the first component lands.
 */
export default async function BookingPage({
  params,
}: {
  params: Promise<{ locale: string; property: string }>
}) {
  const { locale, property } = await params
  setRequestLocale(locale)

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-2 px-6">
      <h1 className="text-2xl font-medium tracking-tight">Booking</h1>
      <p className="text-muted-foreground text-sm">
        Property <code>{property}</code> · Sprint 3.
      </p>
    </main>
  )
}
