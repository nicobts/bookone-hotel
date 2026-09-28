'use client'

import { useTransition } from 'react'
import { useLocale } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { GlobeIcon } from 'lucide-react'
import { Button } from '@bookone/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@bookone/ui/components/dropdown-menu'
import { routing } from '@/i18n/routing'
import { usePathname, useRouter } from '@/i18n/navigation'

/**
 * Globe + the active language code; opens onto the four languages.
 *
 * Each language is named in itself (Deutsch, not "German"), so someone on the
 * wrong one can still find theirs. Switching keeps the page and its query —
 * the login page's `next` must survive a change of language.
 */
const NAMES: Record<string, string> = {
  it: 'Italiano',
  en: 'English',
  de: 'Deutsch',
  sl: 'Slovenščina',
}

export function LocaleSwitcher({ label }: { label: string }) {
  const locale = useLocale()
  const pathname = usePathname()
  const router = useRouter()
  const search = useSearchParams()
  const [pending, startTransition] = useTransition()

  const change = (next: string) => {
    if (next === locale) return
    const query = search.toString()
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, { locale: next })
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={label}
          aria-busy={pending}
          disabled={pending}
          className="text-muted-foreground hover:text-foreground gap-1.5 px-2 font-medium"
        >
          <GlobeIcon aria-hidden />
          {locale.toUpperCase()}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuRadioGroup value={locale} onValueChange={change}>
          {routing.locales.map((code) => (
            <DropdownMenuRadioItem key={code} value={code} lang={code}>
              {NAMES[code] ?? code}
              <span className="text-muted-foreground ml-auto pl-3 text-xs">
                {code.toUpperCase()}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
