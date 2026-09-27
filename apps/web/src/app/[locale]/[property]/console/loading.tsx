import { getTranslations } from 'next-intl/server'
import { PageSkeleton } from '@bookone/ui/components/page-skeleton'

/** Shown while any console page loads, unless the route has its own (a list is the commonest shape here). */
export default async function Loading() {
  const t = await getTranslations('common')
  return <PageSkeleton variant="list" label={t('loading')} />
}
