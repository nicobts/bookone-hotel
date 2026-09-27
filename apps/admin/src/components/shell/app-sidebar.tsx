import {
  ActivityIcon,
  Building2Icon,
  MessagesSquareIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
} from 'lucide-react'
import { Logo } from '@bookone/ui/components/logo'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from '@bookone/ui/components/sidebar'
import { NavMain, type NavGroup } from './nav-main'

/**
 * The operator console's navigation: the hotel console's sidebar (apps/web),
 * same component, same ink chrome, same collapse-to-icons behaviour. Only the
 * entries differ. Operators and owners use one product family, and the
 * frame tells them apart by its label, not by a second design language.
 */
export function AppSidebar({
  role,
  ...props
}: React.ComponentProps<typeof Sidebar> & { role: 'admin' | 'support' }) {
  const groups: NavGroup[] = [
    {
      label: 'Operate',
      items: [
        { title: 'Properties', href: '/', icon: <Building2Icon /> },
        { title: 'Health', href: '/health', icon: <ActivityIcon /> },
      ],
    },
    {
      label: 'Agents',
      items: [{ title: 'Agent playground', href: '/playground', icon: <MessagesSquareIcon /> }],
    },
    {
      label: 'Accountability',
      items: [{ title: 'Audit trail', href: '/audit', icon: <ScrollTextIcon /> }],
    },
  ]

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="gap-2">
        <div className="flex items-center px-2 py-1.5 group-data-[collapsible=icon]:hidden">
          <Logo variant="horizontal" onDark height={18} />
        </div>
        <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs opacity-80 group-data-[collapsible=icon]:justify-center">
          <ShieldCheckIcon className="size-4 shrink-0" aria-hidden />
          <span className="group-data-[collapsible=icon]:hidden">
            Operator console · {role === 'admin' ? 'admin' : 'read-only'}
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <NavMain groups={groups} />
      </SidebarContent>

      <SidebarFooter>
        <p className="px-2 pb-1 text-[10px] leading-none opacity-45 group-data-[collapsible=icon]:hidden">
          Every change is recorded with its reason.
        </p>
      </SidebarFooter>
    </Sidebar>
  )
}
