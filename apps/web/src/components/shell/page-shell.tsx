import { getTranslations } from 'next-intl/server'
import { SiteHeader } from '@/components/shell/site-header'
import { loadProfile } from '@/lib/auth/current-property'
import { requireUser } from '@/lib/auth/current-user'

/**
 * A console page: header plus content well.
 *
 * Every page needs the signed-in person for the user menu, so it is resolved
 * here once rather than in each page. `requireUser` and `loadProfile` are both
 * request-memoised, so this costs nothing beyond what the layout already paid.
 */
export async function PageShell({
  locale,
  title,
  subtitle,
  actions,
  children,
}: {
  locale: string
  title: string
  subtitle?: string
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  const user = await requireUser(locale)
  const profile = await loadProfile(user.id)

  return (
    <>
      <SiteHeader
        title={title}
        subtitle={subtitle}
        email={user.email ?? ''}
        fullName={profile?.fullName ?? null}
        actions={actions}
      />
      <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">{children}</div>
    </>
  )
}

/**
 * What a surface looks like before its sprint lands.
 *
 * Deliberately not a spinner and not a blank page: it names the sprint that
 * fills it, so a stakeholder clicking through the shell can tell "not built
 * yet" apart from "built and broken". Those two look identical otherwise, and
 * the difference matters in a demo.
 */
export async function NotBuiltYet({ sprint, note }: { sprint: string; note: string }) {
  const t = await getTranslations('common')

  return (
    <div className="border-border bg-card flex min-h-64 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-10 text-center">
      <p className="bo-label">{sprint}</p>
      <p className="text-muted-foreground max-w-sm text-sm">{note}</p>
      <span className="sr-only">{t('loading')}</span>
    </div>
  )
}
