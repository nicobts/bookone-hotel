import { Separator } from '@bookone/ui/components/separator'
import { SidebarTrigger } from '@bookone/ui/components/sidebar'
import { requireStaff } from '@/lib/staff'
import { UserMenu } from './user-menu'

/**
 * A console page: the hotel console's header and content well (apps/web
 * `PageShell` + `SiteHeader`), with the operator's menu on the right.
 */
export async function PageShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  const staff = await requireStaff()

  return (
    <>
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
            <UserMenu email={staff.email ?? staff.id} role={staff.role} />
          </div>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">{children}</div>
    </>
  )
}
