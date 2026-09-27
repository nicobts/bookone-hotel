import type { Metadata } from 'next'
import { Geist_Mono, Inter } from 'next/font/google'
import { sharedLocalProject } from '@/lib/env'
import './globals.css'

const inter = Inter({ variable: '--font-inter', subsets: ['latin', 'latin-ext'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: { default: 'BookOne Ops', template: '%s · BookOne Ops' },
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-background text-foreground">
        {sharedLocalProject ? (
          <div className="bg-amber-100 px-4 py-2 text-sm text-amber-900">
            Development: staff sign in against the local tenant project and MFA is optional.
            Production refuses both.
          </div>
        ) : null}
        {children}
      </body>
    </html>
  )
}
