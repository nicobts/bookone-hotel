import { getTranslations } from 'next-intl/server'
import { Logo } from '@/components/brand/logo'

/**
 * The frame every signed-out page sits in.
 *
 * BookOne-branded, not property-branded: at this point nobody knows which
 * property the person belongs to, and a login screen that guesses would be
 * wrong for anyone who works at two.
 *
 * Two panels. The left is ink — the brand kit puts hero moments on the dark
 * canvas — and carries the one editorial line the identity allows. The right is
 * paper and holds the form, because a working control on a dark hero reads as
 * decoration.
 */
export async function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  const t = await getTranslations('auth')
  const line = t('brandLine')
  const emphasis = t('brandLineEmphasis')

  // The italic serif lands on the LAST clause only — the brand kit is explicit
  // that editorial italic does not scale to whole sentences. Splitting on the
  // translated emphasis keeps that true in four languages rather than in one.
  const lead = line.endsWith(emphasis) ? line.slice(0, -emphasis.length) : line
  const tail = line.endsWith(emphasis) ? emphasis : ''

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="bg-ink relative hidden flex-col justify-between p-12 lg:flex">
        <Logo variant="horizontal" onDark height={26} />

        <p className="max-w-md text-[color:var(--bo-fg-on-ink)] text-4xl leading-[1.08] tracking-tight">
          <span className="font-serif">{lead}</span>
          {tail && <span className="bo-editorial text-[color:var(--bo-signal-300)]">{tail}</span>}
        </p>

        <p className="text-xs text-[color:var(--bo-fg-3)]">RT Holding Group GmbH</p>
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
