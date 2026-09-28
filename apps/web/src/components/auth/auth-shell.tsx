import { Suspense } from 'react'
import Image from 'next/image'
import { getTranslations } from 'next-intl/server'
import { Logo } from '@bookone/ui/components/logo'
import { LocaleSwitcher } from '@/components/locale-switcher'

/**
 * The frame every signed-out page sits in (layout after shadcn's login-02).
 *
 * BookOne-branded, not property-branded: at this point nobody knows which
 * property the person belongs to, and a login screen that guesses would be
 * wrong for anyone who works at two.
 *
 * Two columns. The left holds the work: the logo and language on the top
 * line, the form centred, the legal line at the foot. The right is a
 * photograph of the trade — a reception desk at dusk — with the one editorial
 * line the identity allows on a dark fade. On a phone the photograph goes and
 * the form stands alone.
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
    <main className="bg-background grid min-h-dvh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:px-10 md:py-8">
        <header className="flex items-center justify-between gap-4">
          <Logo variant="horizontal" height={22} />
          <Suspense fallback={null}>
            <LocaleSwitcher label={t('language')} />
          </Suspense>
        </header>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">
            <h1 className="text-foreground text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="text-muted-foreground mt-1.5 mb-8 text-sm">{subtitle}</p>
            {children}
          </div>
        </div>

        <footer className="text-muted-foreground flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-xs">
          <span>RT Holding Group GmbH</span>
          <nav aria-label={t('legal')} className="flex gap-4">
            <a href="#" className="hover:text-foreground underline-offset-4 hover:underline">
              {t('terms')}
            </a>
            <a href="#" className="hover:text-foreground underline-offset-4 hover:underline">
              {t('privacyPolicy')}
            </a>
          </nav>
        </footer>
      </div>

      <section className="bg-ink relative hidden overflow-hidden lg:block">
        <Image
          src="/auth/cover-reception.webp"
          alt={t('coverAlt')}
          fill
          priority
          sizes="50vw"
          className="object-cover"
        />
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-ink/90 via-ink/55 to-transparent"
        />
        <div className="absolute inset-x-10 bottom-10 flex flex-col gap-3">
          <p className="max-w-md text-4xl leading-[1.08] tracking-tight text-[color:var(--bo-fg-on-ink)]">
            <span className="font-serif">{lead}</span>
            {tail && <span className="bo-editorial text-[color:var(--bo-signal-200)]">{tail}</span>}
          </p>
          <p className="text-xs text-[color:var(--bo-fg-on-ink)] opacity-70">{t('brandTagline')}</p>
        </div>
      </section>
    </main>
  )
}
