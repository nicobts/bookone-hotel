import { getTranslations } from 'next-intl/server'
import { PageSkeleton } from '@bookone/ui/components/page-skeleton'

/** The monthly statement while it loads: totals, then sections. */
export default async function Loading() {
  const t = await getTranslations('common')
  return <PageSkeleton variant="cards" label={t('loading')} />
}
