'use client'

import { useFormStatus } from 'react-dom'
import { Button } from './button'
import { Spinner } from './spinner'
import { cn } from '../lib/utils'

/**
 * The submit button for a server-action form: `<form action={…}>` stays a
 * server component, and this button alone knows the form is in flight.
 *
 * While pending it does the three things every async control must do
 * (docs/conventions/UI_COMPONENTS.md): it disables, so a slow connection
 * cannot approve twice; it shows a spinner beside the label, never instead of
 * it; and it sets `aria-busy`.
 *
 * With `name` and `value`, only the button that was pressed shows as pending
 * — a form with "Approve" and "Reject" does not spin both. A leading `icon`
 * gives its place to the spinner, so the button keeps its width.
 */
export function PendingButton({
  children,
  pendingLabel,
  className,
  disabled,
  name,
  value,
  icon,
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'type'> & {
  pendingLabel?: string
  icon?: React.ReactNode
}) {
  const { pending: formPending, data } = useFormStatus()
  const pressed = name && value !== undefined && data ? data.get(name) === String(value) : true
  const pending = formPending && pressed

  return (
    <Button
      type="submit"
      name={name}
      value={value}
      disabled={formPending || disabled}
      aria-busy={pending}
      className={cn('gap-2', className)}
      {...props}
    >
      {pending ? <Spinner aria-hidden /> : icon}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  )
}
