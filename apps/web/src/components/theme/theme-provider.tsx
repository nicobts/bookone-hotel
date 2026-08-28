'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'

/**
 * `attribute="data-theme"` rather than the default class.
 *
 * The design system's dark block is `[data-theme="dark"]` and the Tailwind
 * `dark:` variant in globals.css follows the same selector. One switch, one
 * selector — a class-based toggle here would light up half the tokens.
 */
export function ThemeProvider({
  children,
  defaultTheme = 'system',
}: {
  children: React.ReactNode
  defaultTheme?: string
}) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme={defaultTheme}
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  )
}
