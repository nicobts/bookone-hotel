import Image from 'next/image'
import { Logo } from '@bookone/ui/components/logo'

/**
 * The operator console's signed-out frame: the hotel console's `AuthShell`
 * layout (apps/web, after shadcn's login-02) with its own words. The line on
 * the photograph says whose door this is, because it is not the hotels' one.
 *
 * No language switch: the operator console is English only.
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
    <main className="bg-background grid min-h-dvh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:px-10 md:py-8">
        <header className="flex items-center justify-between gap-4">
          <Logo variant="horizontal" height={22} />
        </header>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">
            <h1 className="text-foreground text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="text-muted-foreground mt-1.5 mb-8 text-sm">{subtitle}</p>
            {children}
          </div>
        </div>

        <footer className="text-muted-foreground flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-xs">
          <span>BookOne staff only</span>
          <nav aria-label="Legal" className="flex gap-4">
            <a href="#" className="hover:text-foreground underline-offset-4 hover:underline">
              Terms and conditions
            </a>
            <a href="#" className="hover:text-foreground underline-offset-4 hover:underline">
              Privacy policy
            </a>
          </nav>
        </footer>
      </div>

      <section className="bg-ink relative hidden overflow-hidden lg:block">
        <Image
          src="/auth/cover-reception.webp"
          alt="The reception desk of a small hotel at dusk, with a service bell and room keys"
          fill
          priority
          sizes="50vw"
          className="object-cover"
        />
        <div
          aria-hidden
          className="from-ink/90 via-ink/55 absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t to-transparent"
        />
        <div className="absolute inset-x-10 bottom-10 flex flex-col gap-3">
          <p className="max-w-md text-4xl leading-[1.08] tracking-tight text-[color:var(--bo-fg-on-ink)]">
            <span className="font-serif">Operator console. </span>
            <span className="bo-editorial text-[color:var(--bo-signal-200)]">
              Every change, with its reason.
            </span>
          </p>
          <p className="text-xs text-[color:var(--bo-fg-on-ink)] opacity-70">
            RT Holding Group GmbH
          </p>
        </div>
      </section>
    </main>
  )
}
