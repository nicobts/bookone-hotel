import { cn } from '../lib/utils'

/**
 * A placeholder shaped like the content it stands in for.
 *
 * The registry version pulses `bg-accent`, which in this theme is the canvas
 * colour give or take — invisible on the page, barely there on a card. This
 * one uses its own `--skeleton` token and a slow shimmer (`.bo-skeleton` in
 * globals.css) that stops under reduced motion.
 *
 * Decorative: the region that is loading carries `aria-busy`, not each bar.
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn('bo-skeleton rounded-md', className)}
      {...props}
    />
  )
}

export { Skeleton }
