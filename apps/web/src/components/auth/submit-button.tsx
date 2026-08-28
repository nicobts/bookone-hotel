'use client'

import { Loader2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * The three things every async control must do, in one place.
 *
 *   1. disable while pending — otherwise a slow connection produces two
 *      sign-in attempts, or two bookings for one guest
 *   2. spinner *beside* the label, never instead of it — swapping the text for
 *      a spinner changes the button's width mid-click, which reads as a bug
 *   3. aria-busy
 *
 * Use this rather than reimplementing the pattern; the second point is the one
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
      {pending && <Loader2Icon className="size-4 animate-spin" aria-hidden />}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  )
}
