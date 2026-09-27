'use client'

import { Button } from '@bookone/ui/components/button'
import { Spinner } from '@bookone/ui/components/spinner'
import { cn } from '@bookone/ui/lib/utils'

/**
 * The three things every async control must do, in one place.
 *
 *   1. disable while pending — otherwise a slow connection produces two
 *      sign-in attempts, or two bookings for one guest
 *   2. spinner *beside* the label, never instead of it — swapping the text for
 *      a spinner changes the button's width mid-click, which reads as a bug
 *   3. aria-busy
 *
 * For a server-action form with no client state, use `PendingButton` from
 * `@bookone/ui`, which reads the form's status itself.
 *
 * Use one of the two rather than reimplementing the pattern; the second point is the one
 * that gets dropped, and it is the one people notice.
 */
export function SubmitButton({
  pending,
  children,
  pendingLabel,
  className,
  ...props
}: React.ComponentProps<typeof Button> & {
  pending: boolean
  pendingLabel?: string
}) {
  return (
    <Button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={cn('gap-2', className)}
      {...props}
    >
      {pending && <Spinner aria-hidden />}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  )
}
