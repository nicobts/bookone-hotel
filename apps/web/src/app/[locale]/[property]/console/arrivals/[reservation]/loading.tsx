import { getTranslations } from 'next-intl/server'
import { PageSkeleton } from '@bookone/ui/components/page-skeleton'

/** One arrival while it loads: the record, then its side panel. */
export default async function Loading() {
  const t = await getTranslations('common')
  return <PageSkeleton variant="detail" label={t('loading')} />
}
