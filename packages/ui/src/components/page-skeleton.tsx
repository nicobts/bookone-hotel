import { Separator } from './separator'
import { SidebarTrigger } from './sidebar'
import { Skeleton } from './skeleton'

/**
 * What a console page looks like while it loads: the `loading.tsx` of both
 * consoles (Next shows it the moment a link is followed).
 *
 * Shaped like the page it stands in for — the same 56px header with the
 * sidebar trigger, then a list, a grid of cards or a detail layout — so when
 * the real page lands nothing jumps. The trigger is live: the sidebar still
 * works while the content loads.
 *
 * One region is `aria-busy` with a spoken label; the bars themselves are
 * decorative.
 */
export function PageSkeleton({
  variant = 'list',
  label = 'Loading',
}: {
  variant?: 'list' | 'cards' | 'detail'
  label?: string
}) {
  return (
    <>
      <header className="bg-background/80 sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b backdrop-blur">
        <div className="flex w-full items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 h-4" />
          <div className="grid gap-1.5">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-2.5 w-56 max-w-[50vw]" />
          </div>
        </div>
      </header>

      <div
        role="status"
        aria-busy="true"
        aria-live="polite"
        className="flex flex-1 flex-col gap-6 p-4 md:p-6"
      >
        <span className="sr-only">{label}</span>
        {variant === 'cards' ? <Cards /> : variant === 'detail' ? <Detail /> : <List />}
      </div>
    </>
  )
}

function List() {
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-9 w-64 max-w-full" />
        <Skeleton className="h-9 w-24" />
      </div>
      <ul className="bg-card divide-y rounded-lg border">
        {ROWS.map((width) => (
          <li key={width} className="flex items-center gap-3 p-4">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-3.5" style={{ width: `${width}%` }} />
              <Skeleton className="h-2.5" style={{ width: `${width - 18}%` }} />
            </div>
            <Skeleton className="hidden h-5 w-16 rounded-full sm:block" />
          </li>
        ))}
      </ul>
    </>
  )
}

function Cards() {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="bg-card grid gap-3 rounded-lg border p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-2.5 w-32" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1].map((index) => (
          <div key={index} className="bg-card grid gap-3 rounded-lg border p-5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ))}
      </div>
    </>
  )
}

function Detail() {
  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <div className="bg-card grid content-start gap-4 rounded-lg border p-5">
        <Skeleton className="h-5 w-48" />
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <div key={index} className="grid gap-1.5">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-3.5 w-24" />
            </div>
          ))}
        </div>
        <Skeleton className="mt-2 h-24 w-full" />
      </div>
      <div className="bg-card grid content-start gap-3 rounded-lg border p-5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="mt-2 h-9 w-full" />
      </div>
    </div>
  )
}

/** Row widths, varied so the list reads as content rather than as a pattern. */
const ROWS = [62, 48, 70, 55, 66, 44]
