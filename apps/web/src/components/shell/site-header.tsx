import { UserMenu } from '@/components/shell/user-menu'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'

/**
 * The console's top bar.
 *
 * Carries the page title rather than repeating the property name — the sidebar
 * switcher already answers "whose data is this", and saying it twice on every
 * screen spends the most valuable strip of the page on something already known.
 */
export function SiteHeader({
  title,
  subtitle,
  email,
  fullName,
  actions,
}: {
  title: string
  subtitle?: string
  email: string
  fullName: string | null
  actions?: React.ReactNode
}) {
  return (
    <header className="bg-background/80 sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b backdrop-blur">
      <div className="flex w-full items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-1 h-4" />

        <div className="grid min-w-0 leading-tight">
          <h1 className="truncate text-sm font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="text-muted-foreground truncate text-xs">{subtitle}</p>}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {actions}
          <UserMenu email={email} fullName={fullName} />
        </div>
      </div>
    </header>
  )
}
