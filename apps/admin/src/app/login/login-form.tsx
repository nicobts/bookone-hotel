'use client'

import { useActionState } from 'react'
import { Input } from '@bookone/ui/components/input'
import { Label } from '@bookone/ui/components/label'
import { PendingButton } from '@bookone/ui/components/pending-button'
import { signIn, type AuthState } from '../auth-actions'

export function LoginForm() {
  const [state, action] = useActionState<AuthState, FormData>(signIn, { error: null })

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <PendingButton pendingLabel="Signing in">Sign in</PendingButton>
    </form>
  )
}
