import { getTranslations } from 'next-intl/server'
import { FlaskConicalIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  MEMO — SIMULATED PAYMENT NOTICE. Remove when a real provider is connected.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Rendered wherever a guest could otherwise believe they are paying (ADR-010;
 * the provider is staged, not built). It is deliberately loud: a guest who
 * thinks they have paid a deposit and then arrives to be asked for it again is
 * the single worst experience this staging decision could produce, and the only
 * defence against it is saying so plainly, at the moment of the decision.
 *
 * Three properties this component has on purpose:
 *
 *   - it renders **above** the amount, not below it. A disclaimer under the
 *     button is a disclaimer nobody reads.
 *   - it says what *is* real (the booking) as well as what is not (the money),
 *     because "nothing here is real" would make a guest abandon a booking the
 *     hotel genuinely receives.
 *   - it is driven by the adapter's `simulated` flag through the worker, not by
 *     an environment variable in the web app. The process that would take the
 *     money is the one that gets to say whether it is real.
 *
 * When Stripe lands, `simulated` goes false and this disappears on its own. The
 * component then has no callers and should be deleted with the mock.
 */
export async function SimulatedPaymentNotice({ className }: { className?: string }) {
  const t = await getTranslations('booking.payment.simulated')

  return (
    <div
      role="note"
      className={cn(
        'border-[color:var(--bo-warning-500)]/50 bg-[color:var(--bo-warning-50)] flex gap-3 rounded-lg border p-4 text-[color:var(--bo-ink)]',
        className,
      )}
    >
      <FlaskConicalIcon
        className="mt-0.5 size-4 shrink-0 text-[color:var(--bo-warning-500)]"
        aria-hidden
      />
      <div className="space-y-1">
        <p className="text-sm font-semibold">{t('title')}</p>
        <p className="text-xs leading-relaxed">{t('body')}</p>
      </div>
    </div>
  )
}
