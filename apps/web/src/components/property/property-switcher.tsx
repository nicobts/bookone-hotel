'use client'

import { ChevronsUpDownIcon, CheckIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { UserProperty } from '@bookone/core/db'
import { Link } from '@/i18n/navigation'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'

/**
 * Which property am I looking at.
 *
 * The unambiguous "whose data is on screen" signal the shell needs, because
 * the chrome around it is BookOne-branded and therefore identical at every
 * property (see the surface-brand mapping in UI_COMPONENTS).
 *
 * Switching is a *navigation*, not a state change — that is the whole point of
 * putting the property in the path (ADR-016). Each entry is a real link, so it
 * opens in a new tab, gets bookmarked, and survives a back button.
 *
 * With one property the trigger renders as a plain label: a switcher offering a
 * single choice is a control that teaches people it does nothing.
 */
export function PropertySwitcher({
  properties,
  active,
}: {
  properties: UserProperty[]
  active: UserProperty
}) {
  const t = useTranslations('property')
  const initial = active.name.trim().charAt(0).toUpperCase()

  const badge = (
    <span className="bg-sidebar-primary text-sidebar-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-md font-serif text-xs font-semibold">
      {initial}
    </span>
  )

  const label = (
    <div className="grid flex-1 text-left leading-tight">
      <span className="truncate text-sm font-semibold">{active.name}</span>
      <span className="truncate text-xs opacity-70">{t(`role.${active.role}`)}</span>
    </div>
  )

  if (properties.length < 2) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" className="cursor-default hover:bg-transparent">
            {badge}
            {label}
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" aria-label={t('switcher.switchTo')}>
              {badge}
              {label}
              <ChevronsUpDownIcon className="ml-auto size-4 opacity-60" aria-hidden />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width)">
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              {t('switcher.label')}
            </DropdownMenuLabel>
            {properties.map((property) => (
              <DropdownMenuItem key={property.id} asChild>
                <Link href={`/${property.slug}/console/today`} className="gap-2">
                  <span className="truncate">{property.name}</span>
                  {property.id === active.id && (
                    <CheckIcon className="ml-auto size-4 shrink-0" aria-hidden />
                  )}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
