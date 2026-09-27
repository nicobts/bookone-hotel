'use server'

import { redirect } from 'next/navigation'
import { hasFeature, requireOwner } from '@/lib/auth/current-property'
import { askOwnerAssistant } from '@/lib/worker'

/**
 * The owner asks their assistant (AG-06, WP0.7).
 *
 * Owner-only, like the report: the session is the identity, checked here on
 * every request (`requireOwner`), which is at least what a recorded phone
 * number proves. The concierge feature gates it like the rest of the agent.
 * The answer arrives on the run a moment later; the page shows it on refresh.
 */
export async function askAction(
  context: { locale: string; slug: string },
  formData: FormData,
): Promise<void> {
  const { user, property } = await requireOwner(context.locale, context.slug)
  if (!(await hasFeature(property.id, 'concierge')))
    redirect(`/${context.locale}/${context.slug}/console/today`)

  const message = String(formData.get('message') ?? '').trim()
  if (message) {
    await askOwnerAssistant({
      propertyId: property.id,
      userId: user.id,
      message,
      locale: context.locale,
    })
  }

  redirect(`/${context.locale}/${context.slug}/console/assistant?asked=1`)
}
