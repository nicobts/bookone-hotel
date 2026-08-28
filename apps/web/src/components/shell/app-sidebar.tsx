import { getTranslations } from 'next-intl/server'
import {
  BedDoubleIcon,
  CalendarCheckIcon,
  SettingsIcon,
  SunIcon,
  TriangleAlertIcon,
  UsersIcon,
  UsersRoundIcon,
} from 'lucide-react'
import type { UserProperty } from '@bookone/core/db'
import { Logo } from '@/components/brand/logo'
import { PropertySwitcher } from '@/components/property/property-switcher'
import { NavMain, type NavGroup } from '@/components/shell/nav-main'
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from '@/components/ui/sidebar'

/**
 * The console's navigation.
 *
 * A server component: it takes the property the person is in and builds every
 * link around it, so there is no client-side notion of "current property" that
 * could disagree with the URL. Switching is a navigation, not a state change —
 * the whole point of ADR-016.
 *
 * The chrome is BookOne ink in both themes. An operator running three houses
 * keeps one stable frame and reads *which* house from the switcher, rather than
 * from a dashboard that recolours itself and turns each property into what
 * feels like a different product.
 *
 * Nothing here links to a page that does not exist yet: a sidebar full of dead
 * entries teaches people to distrust the sidebar.
 */
export async function AppSidebar({
  properties,
  active,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  properties: UserProperty[]
  active: UserProperty
}) {
  const t = await getTranslations('nav')
  const base = `/${active.slug}/console`

  /**
   * Two bands, because there are two jobs.
   *
   * Above: running the house today — what needs a person, who is arriving, who
   * is here. Below: the configuration that makes the first band quiet. The same
   * owner does both, but not in the same hour.
   *
   * Today sits first and Exceptions second, in that order deliberately: the
   * console is an exception surface (D15), but a person opening it at 07:00
   * wants the shape of the day before they want the problems in it.
   */
  const groups: NavGroup[] = [
    {
      label: t('sections.operate'),
      items: [
        { title: t('today'), href: `${base}/today`, icon: <SunIcon /> },
        { title: t('exceptions'), href: `${base}/exceptions`, icon: <TriangleAlertIcon /> },
        { title: t('reservations'), href: `${base}/reservations`, icon: <CalendarCheckIcon /> },
        { title: t('guests'), href: `${base}/guests`, icon: <UsersIcon /> },
      ],
    },
    {
      label: t('sections.configure'),
      items: [
        { title: t('rooms'), href: `${base}/room-types`, icon: <BedDoubleIcon /> },
        { title: t('members'), href: `${base}/members`, icon: <UsersRoundIcon /> },
        { title: t('settings'), href: `${base}/settings`, icon: <SettingsIcon /> },
      ],
    },
  ]

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="gap-2">
        {/* The product first, the property second. The wordmark says what this
            is; the switcher says whose data is on screen. */}
        <div className="flex items-center px-2 py-1.5 group-data-[collapsible=icon]:hidden">
          <Logo variant="horizontal" onDark height={18} />
        </div>
        <PropertySwitcher properties={properties} active={active} />
      </SidebarHeader>

      <SidebarContent>
        <NavMain groups={groups} />
      </SidebarContent>

      <SidebarFooter>
        <p className="px-2 pb-1 text-[10px] leading-none opacity-45 group-data-[collapsible=icon]:hidden">
          RT Holding Group GmbH
        </p>
      </SidebarFooter>
    </Sidebar>
  )
}
