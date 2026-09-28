import { PageSkeleton } from '@bookone/ui/components/page-skeleton'

/** Shown while any operator console page loads, unless the route has its own. */
export default function Loading() {
  return <PageSkeleton variant="list" />
}
