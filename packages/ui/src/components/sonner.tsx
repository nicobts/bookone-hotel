'use client'

import { CircleAlertIcon, CircleCheckIcon, InfoIcon, TriangleAlertIcon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { Spinner } from './spinner'

/**
 * The app's toaster, mounted once in each root layout.
 *
 * - Bottom right: clear of page headers and primary actions on a desktop; on a
 *   phone sonner spans the width at the bottom, within thumb reach.
 * - One neutral surface; the type shows in the icon's colour (globals.css,
 *   "Toasts"). A close button on every toast, because an error that stays ten
 *   seconds must be dismissable by hand.
 * - Durations are set per type where toasts are raised (`FlashToaster`):
 *   a confirmation goes quickly, an error stays long enough to read.
 * - The two labels screen readers hear are props, so the hotel console can
 *   pass them translated.
 */
const Toaster = ({
  containerLabel = 'Notifications',
  closeLabel = 'Close',
  ...props
}: ToasterProps & { containerLabel?: string; closeLabel?: string }) => {
  const { resolvedTheme } = useTheme()

  return (
    <Sonner
      theme={(resolvedTheme ?? 'system') as ToasterProps['theme']}
      className="toaster group"
      position="bottom-right"
      closeButton
      visibleToasts={4}
      gap={10}
      offset={20}
      mobileOffset={12}
      containerAriaLabel={containerLabel}
      toastOptions={{ closeButtonAriaLabel: closeLabel }}
      icons={{
        success: <CircleCheckIcon aria-hidden />,
        info: <InfoIcon aria-hidden />,
        warning: <TriangleAlertIcon aria-hidden />,
        error: <CircleAlertIcon aria-hidden />,
        loading: <Spinner aria-hidden />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius-lg)',
          '--width': '380px',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
