import { getTranslations } from 'next-intl/server'
import {
  BedDoubleIcon,
  CalendarCheckIcon,
  ExternalLinkIcon,
  BookOpenIcon,
  ListChecksIcon,
  MessageSquareIcon,
  ReceiptIcon,
  SettingsIcon,
  ShieldIcon,
  SunIcon,
  TriangleAlertIcon,
  UsersIcon,
  UsersRoundIcon,
} from 'lucide-react'
import type { UserProperty } from '@bookone/core/db'
import { Logo } from '@/components/brand/logo'
import { PropertySwitcher } from '@/components/property/property-switcher'
import { NavMain, type NavGroup } from '@/components/shell/nav-main'
import { Link } from '@/i18n/navigation'
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
  /*
   * Staff see the operating band and nothing else (E5.5).
   *
   * This is presentation, not permission. Every configure-band route calls
   * `requireOwner` and 404s for staff, and so does every action behind it — a
   * hidden nav item protects nothing, and the check has to live where the
   * request arrives.
   *
   * What hiding it *does* buy is the acceptance criterion: "productive on day
   * one" means a receptionist opening this on their first shift sees five things
   * they can act on rather than nine, four of which would refuse them.
   */
  const isOwner = active.role === 'owner'

  const groups: NavGroup[] = [
    {
      label: t('sections.operate'),
      items: [
        { title: t('today'), href: `${base}/today`, icon: <SunIcon /> },
        { title: t('exceptions'), href: `${base}/exceptions`, icon: <TriangleAlertIcon /> },
        {
          title: t('conversations'),
          href: `${base}/conversations`,
          icon: <MessageSquareIcon />,
        },
        { title: t('reservations'), href: `${base}/reservations`, icon: <CalendarCheckIcon /> },
        { title: t('guests'), href: `${base}/guests`, icon: <UsersIcon /> },
        /*
         * The report sits last in "Operate" rather than in "Configure", and
         * only for owners.
         *
         * It is neither running the house today nor setting it up — it is the
         * owner reading what they are billed. Of the two bands that is much
         * nearer the first: it is read regularly, by the person who reads Today,
         * and burying an invoice among the settings suggests it is not meant to
         * be looked at.
         *
         * Staff do not see it. Not because the numbers are secret from them,
         * but because "what the property is charged" is not a thing a seasonal
         * receptionist should have to have an opinion about.
         */
        ...(isOwner ? [{ title: t('report'), href: `${base}/report`, icon: <ReceiptIcon /> }] : []),
      ],
    },
    ...(isOwner
      ? [
          {
            label: t('sections.configure'),
            items: [
              { title: t('setup'), href: `${base}/setup`, icon: <ListChecksIcon /> },
              { title: t('knowledge'), href: `${base}/knowledge`, icon: <BookOpenIcon /> },
              { title: t('rooms'), href: `${base}/room-types`, icon: <BedDoubleIcon /> },
              { title: t('members'), href: `${base}/members`, icon: <UsersRoundIcon /> },
              /*
               * Owner-only, and narrower than the rest of this band.
               *
               * A privacy request records that a named guest asked to be
               * forgotten. That is a fact about a person the receptionist who
               * checked them in has no reason to hold — so unlike the other
               * configure items, this one is hidden for a reason about the
               * *subject* rather than about the property. The RLS policy on
               * `privacy_requests` says the same thing at the database.
               */
              { title: t('privacy'), href: `${base}/privacy`, icon: <ShieldIcon /> },
              { title: t('settings'), href: `${base}/settings`, icon: <SettingsIcon /> },
            ],
          },
        ]
      : []),
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
        {/*
          The way out to the guest side.

          Not a nav item: it leaves the console for the page a guest sees, and
          putting it in a band called "Operate" would suggest it is somewhere you
          work. But it needs to be *somewhere* — an owner who cannot find their
          own booking page without being told its URL has, as far as they are
          concerned, no booking page.
        */}
        <Link
          href={`/book/${active.slug}`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs opacity-70 transition-opacity hover:opacity-100 group-data-[collapsible=icon]:justify-center"
        >
          <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden />
          <span className="group-data-[collapsible=icon]:hidden">{t('bookingPage')}</span>
        </Link>

        <p className="px-2 pb-1 text-[10px] leading-none opacity-45 group-data-[collapsible=icon]:hidden">
          RT Holding Group GmbH
        </p>
      </SidebarFooter>
    </Sidebar>
  )
}
