import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server'
import { listSupportAccess } from '@bookone/core/admin'
import { NotBuiltYet, PageShell } from '@/components/shell/page-shell'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@bookone/ui/components/table'
import { requireOwner } from '@/lib/auth/current-property'

/**
 * Settings. Today it holds one thing that is not a setting but belongs to the
 * owner: who at BookOne looked at this property, and why (ADR-031). Read as the
 * owner, so RLS on `domain_events` decides what is shown.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; property: string }>
}) {
  const { locale, property: slug } = await params
  setRequestLocale(locale)
  const { user, property } = await requireOwner(locale, slug)

  const t = await getTranslations('nav')
  const s = await getTranslations('console.settings')
  const format = await getFormatter()
  const access = await listSupportAccess(user.id, property.id)

  const when = (date: Date) => format.dateTime(date, { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <PageShell locale={locale} title={t('settings')}>
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-base font-semibold">{s('supportTitle')}</h2>
          <p className="text-sm text-muted-foreground">{s('supportBody')}</p>
        </div>
        {access.length === 0 ? (
          <p className="text-sm text-muted-foreground">{s('supportNone')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{s('supportWhen')}</TableHead>
                <TableHead>{s('supportWho')}</TableHead>
                <TableHead>{s('supportWhy')}</TableHead>
                <TableHead>{s('supportUntil')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {access.map((entry, index) => (
                <TableRow key={`${entry.at.toISOString()}-${index}`}>
                  <TableCell className="font-mono text-xs">{when(entry.at)}</TableCell>
                  <TableCell className="text-sm">{entry.operator}</TableCell>
                  <TableCell className="text-sm">{entry.reason}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {entry.expiresAt ? when(new Date(entry.expiresAt)) : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
      <NotBuiltYet sprint="Sprint 3" note="Policies, theming, languages and the authority map." />
    </PageShell>
  )
}
