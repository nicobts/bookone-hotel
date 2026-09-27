'use client'

import { useActionState } from 'react'
import { Button } from '@bookone/ui/components/button'
import { Input } from '@bookone/ui/components/input'
import type { ActionState } from './actions'

/**
 * Every change asks why (ADR-031). The reason is written to `admin_audit`
 * verbatim, so it is the sentence the next operator — or an auditor — reads.
 */
export function ReasonForm({
  action,
  hidden,
  label,
  destructive = false,
  compact = false,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>
  hidden: Record<string, string>
  label: string
  destructive?: boolean
  compact?: boolean
}) {
  const [state, formAction, pending] = useActionState(action, { error: null, done: false })

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Input
        name="reason"
        placeholder="Reason (recorded)"
        required
        minLength={3}
        maxLength={500}
        className={compact ? 'h-8 w-56' : 'w-80'}
      />
      <Button
        type="submit"
        size={compact ? 'sm' : 'default'}
        variant={destructive ? 'destructive' : 'default'}
        disabled={pending}
      >
        {label}
      </Button>
      {state.error ? <span className="text-xs text-destructive">{state.error}</span> : null}
    </form>
  )
}
