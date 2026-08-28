import type { CSSProperties } from 'react'
import { getTranslations } from 'next-intl/server'
import type { BookingProperty } from '@bookone/core/db'
import { Logo } from '@/components/brand/logo'
import { cn } from '@/lib/utils'

/**
 * The frame the booking flow sits in.
 *
 * **Property-branded, not BookOne-branded** — the inverse of `AuthShell`. This
 * is the guest's first contact with a hotel and the hotel's name belongs at the
 * top of it; we appear once, small, at the bottom. UI_COMPONENTS.md draws that
 * line, and PRD A1 requires the theming that makes it real.
 *
 * The theme arrives as two custom properties rather than a stylesheet per
 * property: everything brand-coloured in the design system reads through
 * `--bo-primary` and `--bo-accent`, so overriding them here re-skins the whole
 * flow without a single component knowing a property exists.
 */
export async function BookingShell({
  property,
  step,
  children,
}: {
  property: BookingProperty
  /** 1–4, or null on the confirmation screen, which is past the flow. */
  step: number | null
  children: React.ReactNode
}) {
  const t = await getTranslations('booking')

  // Only the two documented hooks, and only when the value looks like a colour.
  // A settings blob is edited by people; an unvalidated value here would let a
  // typo take out the whole page's styling, or worse, close the declaration and
  // start another one.
  const theme: CSSProperties = {
    ...(isColour(property.theme.primary)
      ? { ['--bo-primary' as string]: property.theme.primary }
      : {}),
    ...(isColour(property.theme.accent)
      ? { ['--bo-accent' as string]: property.theme.accent }
      : {}),
  }

  const steps = [t('steps.dates'), t('steps.rooms'), t('steps.details'), t('steps.confirm')]

  return (
    <div style={theme} className="bg-background flex min-h-dvh flex-col">
      <header className="border-border/60 border-b">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between px-6 py-5">
          <span className="text-foreground text-lg font-semibold tracking-tight">
            {property.name}
          </span>
        </div>
      </header>

      {step !== null && (
        <nav
          aria-label={t('stepOf', { current: step, total: steps.length })}
          className="border-border/60 border-b"
        >
          <ol className="mx-auto flex w-full max-w-2xl gap-1 px-6 py-3 text-xs">
            {steps.map((label, index) => {
              const position = index + 1
              const state = position < step ? 'done' : position === step ? 'current' : 'upcoming'

              return (
                <li
                  key={label}
                  aria-current={state === 'current' ? 'step' : undefined}
                  className={cn(
                    'flex flex-1 flex-col gap-1.5',
                    state === 'upcoming' && 'text-muted-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'h-0.5 w-full rounded-full',
                      state === 'upcoming' ? 'bg-border' : 'bg-[color:var(--bo-primary)]',
                    )}
                  />
                  {/* Hidden on the narrowest phones: four labels in German do
                      not fit, and a truncated step name teaches nobody where
                      they are. The bars alone still carry the progress. */}
                  <span className="hidden sm:inline">{label}</span>
                </li>
              )
            })}
          </ol>
        </nav>
      )}

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">{children}</main>

      <footer className="border-border/60 text-muted-foreground border-t px-6 py-6 text-xs">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-2">
          <span>Powered by</span>
          <Logo variant="horizontal" height={14} />
        </div>
      </footer>
    </div>
  )
}

/** Hex only. Narrow on purpose — see the comment at the call site. */
function isColour(value: string | undefined): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(value)
}
