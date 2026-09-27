import type { Metadata } from 'next'
import { Geist_Mono, Inter, Instrument_Serif } from 'next/font/google'
import { ThemeProvider } from '@bookone/ui/components/theme-provider'
import { Toaster } from '@bookone/ui/components/sonner'
import { TooltipProvider } from '@bookone/ui/components/tooltip'
import { sharedLocalProject } from '@/lib/env'
import './globals.css'

/** The same three faces as the hotel console (apps/web), self-hosted via next/font. */
const inter = Inter({ variable: '--font-inter', subsets: ['latin', 'latin-ext'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })
const instrumentSerif = Instrument_Serif({
  variable: '--font-instrument-serif',
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
})

export const metadata: Metadata = {
  title: { default: 'BookOne Ops', template: '%s · BookOne Ops' },
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // next-themes sets the theme attribute before hydration; see apps/web.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full`}
    >
      <body className="flex min-h-full flex-col antialiased">
        <ThemeProvider>
          <TooltipProvider delayDuration={300}>
            {sharedLocalProject ? (
              <div className="bg-amber-100 px-4 py-1.5 text-center text-xs text-amber-900">
                Development: staff sign in against the local tenant project and MFA is optional.
                Production refuses both.
              </div>
            ) : null}
            {children}
          </TooltipProvider>
          <Toaster position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  )
}
