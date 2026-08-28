import { AppSidebar } from '@/components/shell/app-sidebar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { requireProperty, switcherProperties } from '@/lib/auth/current-property'

/**
 * The console shell. Everything under `/[locale]/[property]/console` sits in it.
 *
 * Resolving the property here rather than in each page means a page cannot
 * forget to — and `requireProperty` 404s on a slug the person has no membership
 * in, so by the time any child renders, the property in the URL is one they are
 * entitled to.
 *
 * Pages resolve it again for their own queries. That is a second database round
 * trip, not a second security check: React does not thread a layout's values
 * into the pages below it, and the request-level cache collapses the repeat.
 */
export default async function ConsoleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string; property: string }>
}) {
  const { locale, property: slug } = await params
  const { user, property } = await requireProperty(locale, slug)
  const properties = await switcherProperties(user.id)

  return (
    <SidebarProvider>
      <AppSidebar properties={properties} active={property} />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  )
}
