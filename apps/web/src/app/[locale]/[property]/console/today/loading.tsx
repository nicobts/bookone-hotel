import { getTranslations } from 'next-intl/server'
import { PageSkeleton } from '@bookone/ui/components/page-skeleton'

/** Today while it loads: tiles, then panels. */
export default async function Loading() {
  const t = await getTranslations('common')
  return <PageSkeleton variant="cards" label={t('loading')} />
}
