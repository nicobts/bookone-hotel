'use client'

import { usePathname } from '@/i18n/navigation'
import { Link } from '@/i18n/navigation'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

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
 * Sidebar navigation.
 *
 * A client component only because the active item is derived from the current
 * path. Everything it renders was decided on the server.
 *
 * Active match is exact-or-descendant rather than `startsWith` alone, so
 * `/console/today` does not also light up a hypothetical `/console/today-old`.
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
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`)

              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                    <Link href={item.href}>
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
