'use client'

import { useTransition } from 'react'
import { DownloadIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@bookone/ui/components/button'
import { Spinner } from '@bookone/ui/components/spinner'

/**
 * Download the statement as CSV (E5.4).
 *
 * A client component for one reason: turning the server action's string into a
 * file is a browser API. The *content* is built on the server, from the same
 * report object the page rendered — there is no second code path that could
 * disagree with what the owner is looking at.
 *
 * Disabled, spinning and `aria-busy` while it runs, per the UI conventions.
 * Without the first, an owner on a slow connection downloads the same month
 * three times and wonders which is right.
 *
 * The outcome is said out loud, as a toast. A download that silently does
 * nothing is indistinguishable from a browser blocking it, and the owner's
 * next move is to email us asking for their invoice.
 */
export function ExportButton({
  action,
  label,
  busyLabel,
  errorLabel,
  doneLabel,
}: {
  action: () => Promise<{ filename: string; content: string } | null>
  label: string
  busyLabel: string
  errorLabel: string
  doneLabel: string
}) {
  const [pending, startTransition] = useTransition()

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      aria-busy={pending}
      onClick={() =>
        startTransition(async () => {
          try {
            const file = await action()
            if (!file) {
              toast.error(errorLabel)
              return
            }

            // A BOM, because the target market opens this in Excel and without
            // one an owner called Müller becomes MÃ¼ller on their own invoice.
            // U+FEFF as an escape rather than a literal: the character is
            // invisible in a diff and the linter is right to refuse it.
            const blob = new Blob([`\uFEFF${file.content}`], {
              type: 'text/csv;charset=utf-8',
            })
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')

            anchor.href = url
            anchor.download = file.filename
            anchor.click()

            URL.revokeObjectURL(url)
            toast.success(doneLabel, { description: file.filename })
          } catch {
            toast.error(errorLabel)
          }
        })
      }
    >
      {pending ? <Spinner aria-hidden /> : <DownloadIcon className="size-4" aria-hidden />}
      {pending ? busyLabel : label}
    </Button>
  )
}
