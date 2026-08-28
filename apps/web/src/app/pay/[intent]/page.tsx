import { notFound, redirect } from 'next/navigation'
import { readSimulatedIntent, simulatePayment } from '@/lib/worker'
import { Button } from '@/components/ui/button'

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  MEMO — SIMULATED CHECKOUT. DELETE THIS ROUTE WITH THE MOCK ADAPTER.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Stands in for a payment provider's hosted page (ADR-010). **No card is
 * collected, no money moves, and nothing here is production code.**
 *
 * Two deliberate design choices worth defending:
 *
 * **It looks nothing like the rest of the product.** No property theming, no
 * brand, no locale — it is a plain page with a warning on it. That is on
 * purpose: a fake payment screen that looks like a real one is a fake payment
 * screen somebody eventually mistakes for a real one, in a demo, in front of a
 * hotelier. A real provider's page also looks nothing like our app.
 *
 * **The outcome is a choice, not a form.** Succeed, decline, or walk away —
 * because the failure paths are the ones worth being able to exercise, and a
 * fake card number field would only ever produce the happy one.
 *
 * What happens after the click is entirely real: the worker moves the mock
 * intent, signs a webhook payload, and feeds it through the same handler,
 * signature check and idempotency a live provider's delivery would hit. When
 * Stripe arrives, this page and its action are deleted and nothing downstream
 * changes.
 */

export const dynamic = 'force-dynamic'

async function act(intentId: string, returnUrl: string, formData: FormData): Promise<void> {
  'use server'

  const choice = String(formData.get('outcome') ?? '')

  if (choice === 'abandon') redirect(returnUrl)

  const outcome = choice === 'failed' ? 'failed' : 'succeeded'
  await simulatePayment({ intentId, outcome })

  // Back to the booking surface either way. It reads the reservation's real
  // status, so a declined payment lands on the payment step with a reason and a
  // successful one lands on the confirmation — neither is decided here.
  redirect(returnUrl)
}

export default async function SimulatedCheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ intent: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { intent: intentId } = await params
  const query = await searchParams

  const intent = await readSimulatedIntent(intentId)

  // Also the answer when a real provider is configured: the worker refuses to
  // describe an intent it cannot simulate, so this route 404s rather than
  // rendering a fake page over a live payment.
  if (!intent) notFound()

  const returnParam = query.return
  const returnUrl =
    typeof returnParam === 'string' && returnParam.startsWith('/') ? returnParam : '/'

  const amount = new Intl.NumberFormat('en', {
    style: 'currency',
    currency: intent.currency,
  }).format(intent.amountCents / 100)

  const action = act.bind(null, intentId, returnUrl)

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-12">
      <div className="rounded-lg border-2 border-dashed border-[color:var(--bo-warning-500)] bg-[color:var(--bo-warning-50)] p-5">
        <p className="text-sm font-semibold tracking-tight text-[color:var(--bo-ink)]">
          Simulated payment — no money will be taken
        </p>
        <p className="mt-2 text-xs leading-relaxed text-[color:var(--bo-ink)]">
          No payment provider is connected to this environment. Nothing is charged, no card details
          are collected, and this page is not part of the production flow. The booking itself is
          real, and everything after this click — the ledger entry, the provider webhook, the
          confirmation email — takes the path that will ship.
        </p>
      </div>

      <dl className="grid gap-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Amount</dt>
          <dd className="tabular-nums">{amount}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Intent</dt>
          <dd className="font-mono text-xs">{intent.id}</dd>
        </div>
      </dl>

      <div className="flex flex-col gap-2">
        {/*
          Three outcomes, because the two unhappy ones are the reason this page
          exists. A card-number field would only ever produce the first.
        */}
        <form action={action}>
          <input type="hidden" name="outcome" value="succeeded" />
          <Button type="submit" className="w-full" size="lg">
            Simulate a successful payment
          </Button>
        </form>

        <form action={action}>
          <input type="hidden" name="outcome" value="failed" />
          <Button type="submit" variant="outline" className="w-full">
            Simulate a declined card
          </Button>
        </form>

        <form action={action}>
          <input type="hidden" name="outcome" value="abandon" />
          <Button type="submit" variant="ghost" className="w-full">
            Go back without paying
          </Button>
        </form>
      </div>
    </main>
  )
}
