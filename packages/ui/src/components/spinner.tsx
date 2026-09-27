import { cn } from '../lib/utils'

/**
 * The platform's one spinner (shadcn's `spinner`, redrawn).
 *
 * The registry version rotates lucide's `Loader2`, a broken circle whose two
 * rounded ends wobble visibly at 16px and read as a glyph rather than as
 * progress. This one is a faint full track with a quarter arc running round
 * it: the shape stays still, only the arc moves, which is what the eye reads
 * as "working".
 *
 * - `currentColor`, so it takes the text colour of the button it sits in.
 * - Reduced motion slows it down rather than stopping it — a spinner that does
 *   not move looks like a frozen page.
 * - Labelled on its own; inside a control that already says what is happening
 *   ("Accesso in corso"), pass `aria-hidden` and let the label speak.
 */
function Spinner({
  className,
  label = 'Loading',
  ...props
}: React.ComponentProps<'svg'> & { label?: string }) {
  const hidden = props['aria-hidden'] === true || props['aria-hidden'] === 'true'

  return (
    <svg
      data-slot="spinner"
      viewBox="0 0 24 24"
      fill="none"
      role={hidden ? undefined : 'status'}
      aria-label={hidden ? undefined : label}
      className={cn(
        'size-4 shrink-0 animate-spin [animation-duration:0.7s] motion-reduce:[animation-duration:1.6s]',
        className,
      )}
      {...props}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2.5" />
      <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

export { Spinner }
