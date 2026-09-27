import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { requireStaff } from '@/lib/staff'
import { signOut } from '../auth-actions'

export const dynamic = 'force-dynamic'

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff()

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <nav className="flex items-center gap-5 text-sm">
          <span className="font-semibold">BookOne Ops</span>
          <Link href="/" className="hover:underline">
            Properties
          </Link>
          <Link href="/health" className="hover:underline">
            Health
          </Link>
          <Link href="/audit" className="hover:underline">
            Audit trail
          </Link>
        </nav>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>
            {staff.email} · {staff.role}
          </span>
          <form action={signOut}>
            <Button variant="outline" size="sm" type="submit">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      {children}
    </div>
  )
}
