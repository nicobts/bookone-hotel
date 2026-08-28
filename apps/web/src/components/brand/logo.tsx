import Image from 'next/image'
import { cn } from '@/lib/utils'

/**
 * The BookOne mark and wordmark.
 *
 * Two variants because the logo carries its own colours — signal blue and ink
 * on light, a lighter blue and white on dark. Recolouring it with CSS is
 * explicitly forbidden by the brand kit, so the negative artwork is a separate
 * file rather than a filter.
 *
 * Minimum sizes from the brand kit: the mark is never below 16px, the
 * horizontal lockup never below 120px.
 */
export function Logo({
  variant = 'horizontal',
  onDark = false,
  height = 24,
  className,
}: {
  variant?: 'horizontal' | 'mark'
  onDark?: boolean
  height?: number
  className?: string
}) {
  const file =
    variant === 'mark'
      ? onDark
        ? '/logo_bookone_mark_negative.svg'
        : '/logo_bookone_mark.svg'
      : onDark
        ? '/logo_bookone_horizontal_negative.svg'
        : '/logo_bookone_horizontal.svg'

  const width = variant === 'mark' ? height : height * 5.2

  return (
    <Image
      src={file}
      alt="BookOne"
      width={Math.round(width)}
      height={height}
      className={cn('block h-auto w-auto', className)}
      style={{ height }}
      priority
    />
  )
}
