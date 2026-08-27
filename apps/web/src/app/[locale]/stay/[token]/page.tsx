import { setRequestLocale } from 'next-intl/server'

/**
 * Guest journey surface — pre-arrival, in-stay, departure (PRD B1–B5).
 *
 * Reached by a short-lived signed token, resolved server-side. Guests never
 * hold a Supabase session (ADR-007), and arrival can only be completed from a
 * reservation-scoped source (E3.1).
 *
 * Built in Sprint 5.
 */
export default async function StayPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-2 px-6">
      <h1 className="text-2xl font-medium tracking-tight">Your stay</h1>
      <p className="text-muted-foreground text-sm">Sprint 5.</p>
    </main>
  )
}
