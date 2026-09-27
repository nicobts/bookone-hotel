import { SidebarInset, SidebarProvider } from '@bookone/ui/components/sidebar'
import { AppSidebar } from '@/components/shell/app-sidebar'
import { requireStaff } from '@/lib/staff'

export const dynamic = 'force-dynamic'

/** The hotel console's shell (apps/web), for operators. */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff()

  return (
    <SidebarProvider>
      <AppSidebar role={staff.role} />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  )
}
