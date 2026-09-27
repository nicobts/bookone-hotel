import { cn } from '../lib/utils'

/**
 * The BookOne Hotel lockup and the BookOne mark.
 *
 * Inline SVG rather than an image file, so the "Hotel" descriptor is real text
 * in the product's interface face (Inter), sitting on the wordmark's own
 * baseline. The artwork paths are the brand kit's, unchanged
 * (`public/logo_bookone_*.svg`).
 *
 * The descriptor is fixed in the drawing, not in CSS:
 * - its capitals are as tall as the wordmark's lowercase (x-height 71.9 → 172.3);
 * - `textLength` pins its width, so the lockup keeps its proportions even
 *   before the font has loaded;
 * - a thin rule, the height of that same band, separates it from the wordmark.
 *
 * Two palettes because the logo carries its own colours — signal blue and ink
 * on light, a lighter blue and white on dark. Recolouring it with CSS is
 * explicitly forbidden by the brand kit, so each palette is spelled out here.
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
  const c = onDark ? DARK : LIGHT
  const width = variant === 'mark' ? MARK_WIDTH : LOCKUP_WIDTH

  return (
    <svg
      role="img"
      aria-label="BookOne Hotel"
      viewBox={`0 0 ${width} ${HEIGHT}`}
      height={height}
      width={Math.round((height * width) / HEIGHT)}
      className={cn('block shrink-0', className)}
    >
      <Mark c={c} />
      {variant === 'horizontal' ? (
        <>
          {WORDMARK.map((d) => (
            <path key={d.slice(0, 16)} fill={c.ink} d={d} />
          ))}
          <rect
            fill={c.blue}
            opacity={0.55}
            x={RULE_X}
            y={X_HEIGHT_TOP}
            width={RULE_WIDTH}
            height={BASELINE - X_HEIGHT_TOP}
          />
          <text
            x={DESCRIPTOR_X}
            y={BASELINE}
            fill={c.blue}
            fontSize={138}
            fontWeight={600}
            textLength={DESCRIPTOR_WIDTH}
            lengthAdjust="spacing"
            style={{
              fontFamily: 'var(--bo-font-sans, Inter, ui-sans-serif, system-ui, sans-serif)',
            }}
          >
            HOTEL
          </text>
        </>
      ) : null}
    </svg>
  )
}

const LIGHT = { ink: '#12283e', blue: '#0466c8' }
const DARK = { ink: '#ffffff', blue: '#4da3ff' }

// Brand-kit geometry, in artwork units.
const HEIGHT = 195.96
const MARK_WIDTH = 185.54
const WORDMARK_END = 1037.26
const BASELINE = 172.3
const X_HEIGHT_TOP = 71.9
const GAP = 64
const RULE_WIDTH = 7
const RULE_X = WORDMARK_END + GAP
const DESCRIPTOR_X = RULE_X + RULE_WIDTH + GAP
const DESCRIPTOR_WIDTH = 452
const LOCKUP_WIDTH = DESCRIPTOR_X + DESCRIPTOR_WIDTH

function Mark({ c }: { c: typeof LIGHT }) {
  return (
    <>
      <path fill={c.ink} d={MARK_FRAME} />
      {[33.93, 87.86, 141.78].map((x) => (
        <rect key={x} fill={c.blue} x={x} y={0} width={9.83} height={33.73} rx={4.91} ry={4.91} />
      ))}
      {[
        [71.96, 83.32],
        [125.35, 83.32],
        [18.56, 133.83],
        [71.96, 133.83],
      ].map(([x, y]) => (
        <rect
          key={`${x}-${y}`}
          fill={c.ink}
          x={x}
          y={y}
          width={39.39}
          height={35.18}
          rx={17.59}
          ry={17.59}
        />
      ))}
      {MARK_CHECKS.map((d) => (
        <path key={d.slice(0, 16)} fill={c.blue} d={d} />
      ))}
    </>
  )
}

const MARK_FRAME =
  'M185.54,51.42v-20.53c0-7.74-6.27-14.02-14.02-14.02h-15.88v11.95c0,4.93-4.01,8.94-8.94,8.94s-8.94-4.01-8.94-8.94v-11.95h-36.03v11.95c0,4.93-4.01,8.94-8.94,8.94s-8.94-4.01-8.94-8.94v-11.95h-36.03v11.95c0,4.93-4.01,8.94-8.94,8.94s-8.94-4.01-8.94-8.94v-11.95h-15.88C6.28,16.87,0,23.14,0,30.89v20.53h0v130.52c0,7.74,6.28,14.02,14.02,14.02h157.5c7.74,0,14.02-6.28,14.02-14.02V51.42h0ZM171.52,187H14.02c-2.79,0-5.06-2.27-5.06-5.06v-116.82h167.62v116.82c0,2.79-2.27,5.06-5.06,5.06Z'

const MARK_CHECKS = [
  'M62.22,93.24l-22.77,22.77c-.94.94-2.45.94-3.39,0l-15.5-15.5c-.91-.91-.91-2.38,0-3.29l4.46-4.46c.91-.91,2.38-.91,3.29,0l9.44,9.44,16.71-16.71c.91-.91,2.38-.91,3.29,0l4.46,4.46c.91.91.91,2.38,0,3.29Z',
  'M165.88,144.09l-22.77,22.77c-.94.94-2.45.94-3.39,0l-15.5-15.5c-.91-.91-.91-2.38,0-3.29l4.46-4.46c.91-.91,2.38-.91,3.29,0l9.44,9.44,16.71-16.71c.91-.91,2.38-.91,3.29,0l4.46,4.46c.91.91.91,2.38,0,3.29Z',
]

const WORDMARK = [
  'M279.47,172.3h-58.86V45.95h56.88c25.74,0,41.04,12.78,41.04,32.76,0,15.3-9.18,25.2-21.42,28.8,14.76,3.06,24.3,16.02,24.3,30.42,0,20.88-15.3,34.38-41.94,34.38ZM271.55,70.6h-20.16v26.46h20.16c10.08,0,15.66-4.5,15.66-13.14s-5.58-13.32-15.66-13.32ZM273.71,119.56h-22.32v27.9h22.68c10.26,0,16.2-4.68,16.2-13.68s-6.3-14.22-16.56-14.22Z',
  'M384.95,173.74c-29.52,0-51.84-19.8-51.84-51.66s22.86-51.66,52.2-51.66,52.2,19.8,52.2,51.66-23.04,51.66-52.56,51.66ZM384.95,147.1c10.98,0,21.24-8.1,21.24-25.02s-10.08-25.02-20.88-25.02-20.88,7.92-20.88,25.02,9.36,25.02,20.52,25.02Z',
  'M499.61,173.74c-29.52,0-51.84-19.8-51.84-51.66s22.86-51.66,52.2-51.66,52.2,19.8,52.2,51.66-23.04,51.66-52.56,51.66ZM499.61,147.1c10.98,0,21.24-8.1,21.24-25.02s-10.08-25.02-20.88-25.02-20.88,7.92-20.88,25.02,9.36,25.02,20.52,25.02Z',
  'M568.55,39.11h30.78v73.62l30.42-40.86h37.98l-41.76,50.4,42.12,50.04h-38.16l-30.6-42.12v42.12h-30.78V39.11Z',
  'M739.54,173.56c-35.82,0-64.98-26.82-64.98-64.8s29.16-64.62,64.98-64.62,64.62,26.64,64.62,64.62-28.8,64.8-64.62,64.8ZM739.54,145.48c20.16,0,33.3-14.58,33.3-36.72s-13.14-36.72-33.3-36.72-33.48,14.22-33.48,36.72,12.96,36.72,33.48,36.72Z',
  'M890.56,117.76c0-13.68-7.56-21.24-19.26-21.24s-19.26,7.56-19.26,21.24v54.54h-30.78v-100.44h30.78v13.32c6.12-8.46,16.92-14.4,30.42-14.4,23.22,0,38.7,15.84,38.7,42.84v58.68h-30.6v-54.54Z',
  'M987.22,173.74c-29.52,0-50.76-19.8-50.76-51.66s20.88-51.66,50.76-51.66,50.04,19.44,50.04,50.04c0,2.88-.18,5.94-.54,9h-69.66c1.08,13.14,9.18,19.26,19.08,19.26,8.64,0,13.5-4.32,16.02-9.72h32.76c-4.86,19.62-22.68,34.74-47.7,34.74ZM967.24,112.36h38.52c0-10.98-8.64-17.28-18.9-17.28s-17.82,6.12-19.62,17.28Z',
]
