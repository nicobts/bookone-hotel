'use client'

import * as React from 'react'
import { EyeIcon, EyeOffIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * Password field with a reveal toggle.
 *
 * Written here rather than taken from the registry because neither registry
 * provides one, and three details have to be right or it actively harms:
 *
 *   - `type="button"` — the default is `submit`, so the toggle would submit
 *     the form instead of revealing the password
 *   - `tabIndex={-1}` — keeps tab order email -> password -> submit, rather
 *     than routing every keyboard user through a decoration
 *   - a label that changes with state — an icon alone tells a screen reader
 *     nothing about whether the password is currently visible
 */
export function PasswordInput({
  className,
  showLabel = 'Show password',
  hideLabel = 'Hide password',
  ...props
}: React.ComponentProps<typeof Input> & {
  showLabel?: string
  hideLabel?: string
}) {
  const [visible, setVisible] = React.useState(false)

  return (
    <div className="relative">
      <Input type={visible ? 'text' : 'password'} className={cn('pr-10', className)} {...props} />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? hideLabel : showLabel}
        aria-pressed={visible}
        className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md transition-colors"
      >
        {visible ? (
          <EyeOffIcon className="size-4" aria-hidden />
        ) : (
          <EyeIcon className="size-4" aria-hidden />
        )}
      </button>
    </div>
  )
}
