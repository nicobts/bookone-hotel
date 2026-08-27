import { setRequestLocale } from 'next-intl/server'

/**
 * Owner console — an exception-handling surface, not a data-entry surface (D15).
 *
 * The home screen is the exceptions inbox (C1), not a dashboard: unreflected
 * reservations, failed payments, pre-arrival incomplete at T-12h, Alloggiati
 * unconfirmed, escalated messages, reconciliation discrepancies — each with a
 * one-tap resolution. Today (C2) sits beside it.
 *
 * Shell + Today placeholder is Sprint 1; C1 lands in Sprint 4.
 */
export default async function ConsolePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-2 px-6">
      <h1 className="text-2xl font-medium tracking-tight">Console</h1>
      <p className="text-muted-foreground text-sm">Exceptions and Today · Sprint 1 shell.</p>
    </main>
  )
}
