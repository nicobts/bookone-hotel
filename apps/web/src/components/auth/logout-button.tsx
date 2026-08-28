'use client'

import { useRouter } from '@/i18n/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'

export function LogoutButton({ label }: { label: string }) {
  const router = useRouter()

  return (
    <Button
      variant="outline"
      className="w-full"
      onClick={async () => {
        await createClient().auth.signOut()
        router.replace('/login')
        // The server components above hold the signed-in user; without this the
        // page renders once more from cache before the proxy catches up.
        router.refresh()
      }}
    >
      {label}
    </Button>
  )
}
