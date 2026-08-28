'use client'

import { LogOutIcon, MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { createClient } from '@/lib/supabase/client'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function UserMenu({ email, fullName }: { email: string; fullName: string | null }) {
  const t = useTranslations('auth')
  const tTheme = useTranslations('theme')
  const { setTheme } = useTheme()
  const router = useRouter()

  const label = fullName?.trim() || email
  const initials = label.slice(0, 2).toUpperCase()

  async function signOut() {
    await createClient().auth.signOut()
    // `refresh` after replace: the server components above this one hold the
    // signed-in user, and without it the console renders once more from cache
    // before the proxy catches up.
    router.replace('/login')
    router.refresh()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label={label}>
          <Avatar className="size-8">
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="grid leading-tight">
            {fullName && <span className="truncate text-sm font-medium">{fullName}</span>}
            <span className="text-muted-foreground truncate text-xs">{email}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
          {tTheme('toggle')}
        </DropdownMenuLabel>
        <DropdownMenuItem onClick={() => setTheme('light')}>
          <SunIcon aria-hidden />
          {tTheme('light')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')}>
          <MoonIcon aria-hidden />
          {tTheme('dark')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('system')}>
          <MonitorIcon aria-hidden />
          {tTheme('system')}
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut}>
          <LogOutIcon aria-hidden />
          {t('logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
