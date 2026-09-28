'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@bookone/ui/components/sidebar'

export interface NavItem {
  title: string
  href: string
  icon: React.ReactNode
}

export interface NavGroup {
  label?: string
  items: NavItem[]
}

/**
 * The same navigation component as the hotel console's (apps/web), with
 * Next's own link instead of the locale-aware one: the operator console has
 * no locales. `/` is active only on itself, everything else on its subtree.
 */
export function NavMain({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname()

  return (
    <>
      {groups.map((group, index) => (
        <SidebarGroup key={group.label ?? index}>
          {group.label && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
          <SidebarMenu>
            {group.items.map((item) => {
              const active =
                item.href === '/'
                  ? pathname === '/' || pathname.startsWith('/properties')
                  : pathname === item.href || pathname.startsWith(`${item.href}/`)

              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                    <Link href={item.href as '/'}>
                      {item.icon}
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarGroup>
      ))}
    </>
  )
}
