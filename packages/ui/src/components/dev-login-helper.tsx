'use client'

/*
 * DEV-LOGIN-HELPER — development only, temporary. Delete before GA:
 * `grep -rn DEV-LOGIN-HELPER` finds every piece.
 *
 * A "?" in the top-right corner of a login page that fills in a demo account.
 * The pages render it only when NODE_ENV is "development" and pass the
 * accounts as props from server code, so neither the button nor any password
 * reaches a production build.
 */
import * as React from 'react'
import { CircleHelpIcon, XIcon } from 'lucide-react'

export interface DevAccount {
  email: string
  password: string
  label: string
}

/** Set a value the way a person typing would, so React-controlled inputs see it too. */
function fill(id: string, value: string) {
  const input = document.getElementById(id) as HTMLInputElement | null
  if (!input) return
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

export function DevLoginHelper({ accounts }: { accounts: DevAccount[] }) {
  const [open, setOpen] = React.useState(false)

  return (
    <div className="fixed top-3 right-3 z-50 flex flex-col items-end gap-2">
      <button
        type="button"
        aria-label={open ? 'Close demo accounts' : 'Demo accounts (development only)'}
        onClick={() => setOpen((value) => !value)}
        className="flex size-9 items-center justify-center rounded-full border border-amber-300 bg-amber-100 text-amber-900 shadow-sm transition-colors hover:bg-amber-200"
      >
        {open ? <XIcon className="size-4" /> : <CircleHelpIcon className="size-5" />}
      </button>

      {open ? (
        <div className="bg-background w-72 rounded-lg border p-2 text-sm shadow-lg">
          <p className="text-muted-foreground px-2 pt-1 pb-2 text-xs">
            Demo accounts — development only. Click to fill the form.
          </p>
          <ul className="flex flex-col">
            {accounts.map((account) => (
              <li key={account.email}>
                <button
                  type="button"
                  onClick={() => {
                    fill('email', account.email)
                    fill('password', account.password)
                    setOpen(false)
                  }}
                  className="hover:bg-muted flex w-full flex-col rounded-md px-2 py-1.5 text-left"
                >
                  <span className="font-medium">{account.label}</span>
                  <span className="text-muted-foreground font-mono text-xs">{account.email}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
