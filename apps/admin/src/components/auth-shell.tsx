import { Logo } from '@bookone/ui/components/logo'

/**
 * The hotel console's signed-out frame (apps/web `AuthShell`): ink panel with
 * the brand, paper panel with the form. The line on the ink says whose door
 * this is, because it is not the hotels' one.
 */
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="bg-ink relative hidden flex-col items-start justify-between p-12 lg:flex">
        <Logo variant="horizontal" onDark height={26} />

        <p className="max-w-md text-4xl leading-[1.08] tracking-tight text-[color:var(--bo-fg-on-ink)]">
          <span className="font-serif">Operator console. </span>
          <span className="bo-editorial text-[color:var(--bo-signal-300)]">
            Every change, with its reason.
          </span>
        </p>

        <p className="text-xs text-[color:var(--bo-fg-3)]">BookOne staff only</p>
      </section>

      <section className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo variant="horizontal" height={24} />
          </div>

          <h1 className="text-foreground text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-muted-foreground mt-1.5 mb-8 text-sm">{subtitle}</p>

          {children}
        </div>
      </section>
    </main>
  )
}
