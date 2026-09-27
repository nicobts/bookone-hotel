'use client'

import { useTransition } from 'react'
import { DownloadIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@bookone/ui/components/button'
import { Spinner } from '@bookone/ui/components/spinner'
import type { ExportStart } from '@/app/[locale]/[property]/console/privacy/actions'

/**
 * Record a subject-access request, then download the bundle (E8.1).
 *
 * A client control rather than a form: the action returns the address and the
 * browser is sent there, because a server action that redirects to a file
 * never finishes and would leave the button waiting. Busy, spinning and
 * `aria-busy` while the request is recorded; the outcome is a toast.
 */
export function ExportDataButton({
  action,
  label,
  doneLabel,
  errorLabel,
}: {
  action: () => Promise<ExportStart>
  label: string
  doneLabel: string
  errorLabel: string
}) {
  const [pending, startTransition] = useTransition()

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={pending}
      aria-busy={pending}
      onClick={() =>
        startTransition(async () => {
          try {
            const started = await action()
            if (!started.ok) {
              toast.error(started.message)
              return
            }
            toast.success(doneLabel)
            window.location.assign(started.url)
          } catch {
            toast.error(errorLabel)
          }
        })
      }
    >
      {pending ? <Spinner aria-hidden /> : <DownloadIcon className="size-4" aria-hidden />}
      {label}
    </Button>
  )
}
