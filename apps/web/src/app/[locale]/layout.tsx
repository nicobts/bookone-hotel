import type { Metadata } from 'next'
import { Geist_Mono, Inter, Instrument_Serif } from 'next/font/google'
import { NextIntlClientProvider, hasLocale } from 'next-intl'
import { notFound } from 'next/navigation'
import { routing } from '@/i18n/routing'
import { ThemeProvider } from '@/components/theme/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { getCurrentUser } from '@/lib/auth/current-user'
import { loadProfile } from '@/lib/auth/current-property'
import '../globals.css'

/**
 * Three faces, three jobs (brand kit §04):
 *   Inter            — everything in the product. It is a working tool.
 *   Instrument Serif — the brand voice. Marketing, login, one clause at a time.
 *   Geist Mono       — every number. Rates, folios and occupancy get compared
 *                      down a column, and tabular figures are what make that work.
 *
 * Loaded through next/font so they are self-hosted and preloaded rather than
 * fetched from a third party on first paint — which also keeps the EU-residency
 * story simple (D9): no request leaves for a font.
 */
const inter = Inter({ variable: '--font-inter', subsets: ['latin', 'latin-ext'] })

const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

/** Single weight: the design system only ever sets the serif at 400. */
const instrumentSerif = Instrument_Serif({
  variable: '--font-instrument-serif',
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
})

const TITLE = 'BookOne'
const DESCRIPTION = 'Guest-journey-first hospitality platform for independent hotels.'

export const metadata: Metadata = {
  title: { default: TITLE, template: `%s · ${TITLE}` },
  description: DESCRIPTION,
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  if (!hasLocale(routing.locales, locale)) {
    notFound()
  }

  // Signed-out pages have no profile, so login and the guest surfaces follow
  // the system preference. `getCurrentUser` rather than `requireUser`: this
  // layout renders for visitors who have every right to be signed out.
  const user = await getCurrentUser()
  const profile = user ? await loadProfile(user.id) : null

  return (
    // suppressHydrationWarning is required, not optional: next-themes sets the
    // attribute on this element before React hydrates, so server and client
    // markup differ by design and React would otherwise log it as a mismatch.
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${inter.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full`}
    >
      <body className="flex min-h-full flex-col antialiased">
        <ThemeProvider defaultTheme={profile?.theme ?? 'system'}>
          <NextIntlClientProvider>
            {/* Mounted once. Several registry components — the sidebar among
                them — assume a tooltip provider exists above them, and mounting
                per page means discovering the omission one page at a time. */}
            <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
            <Toaster position="top-center" />
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
