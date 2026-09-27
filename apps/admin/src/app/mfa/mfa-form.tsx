'use client'

import { useActionState, useState, useTransition } from 'react'
import { Button } from '@bookone/ui/components/button'
import { Input } from '@bookone/ui/components/input'
import { Label } from '@bookone/ui/components/label'
import { enrolTotp, verifyTotp, type AuthState, type EnrolState } from '../auth-actions'

export function MfaForm({ factorId: existing }: { factorId: string | null }) {
  const [enrolment, setEnrolment] = useState<EnrolState | null>(null)
  const [starting, startTransition] = useTransition()
  const [state, action, pending] = useActionState<AuthState, FormData>(verifyTotp, {
    error: null,
  })

  const factorId = existing ?? enrolment?.factorId ?? null

  if (!factorId) {
    return (
      <div className="flex flex-col gap-3">
        <Button
          disabled={starting}
          onClick={() => startTransition(async () => setEnrolment(await enrolTotp()))}
        >
          Set up an authenticator
        </Button>
        {enrolment?.error ? <p className="text-sm text-destructive">{enrolment.error}</p> : null}
      </div>
    )
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      {enrolment?.qr ? (
        // A data: URI from the Auth server, rendered once; next/image adds nothing here.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={enrolment.qr} alt="Scan with your authenticator app" className="size-48" />
      ) : null}
      <input type="hidden" name="factorId" value={factorId} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="code">Code</Label>
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          required
        />
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <Button type="submit" disabled={pending}>
        Verify
      </Button>
    </form>
  )
}
