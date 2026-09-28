'use client'

import { useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { FLASH_COOKIE, decodeFlashes, type Flash } from '../lib/flash'

/**
 * Turns flash cookies (`lib/flash.ts`) into toasts. Mounted once per app,
 * inside a Suspense boundary, next to the `Toaster`.
 *
 * A server action's cookie can arrive three ways, and each is covered:
 * - after a redirect to another page: the route change;
 * - after a redirect to the same page, or a revalidation with no navigation:
 *   the cookie store's change event where the browser has one, otherwise a
 *   short watch that starts when any form on the page is submitted;
 * - after a full page load (a form posted without script): the first mount.
 *
 * The flash id doubles as the toast id, so a message read twice (a double
 * effect in development, two triggers racing) shows once.
 */
const WATCH_MS = 20_000
const WATCH_EVERY_MS = 150

const DURATION: Record<Flash['kind'], number> = {
  success: 4_000,
  info: 5_000,
  warning: 8_000,
  error: 10_000,
}

function readCookie(): string | null {
  const prefix = `${FLASH_COOKIE}=`
  const entry = document.cookie.split('; ').find((part) => part.startsWith(prefix))
  if (!entry) return null
  try {
    return decodeURIComponent(entry.slice(prefix.length))
  } catch {
    return null
  }
}

/** Show whatever is queued, clear the queue; true when there was something. */
function drain(): boolean {
  const raw = readCookie()
  if (raw === null) return false
  document.cookie = `${FLASH_COOKIE}=; Max-Age=0; path=/; SameSite=Lax`

  for (const flash of decodeFlashes(raw)) {
    toast[flash.kind](flash.title, {
      id: flash.id,
      duration: DURATION[flash.kind],
      ...(flash.description ? { description: flash.description } : {}),
    })
  }
  return true
}

export function FlashToaster() {
  const pathname = usePathname()
  const search = useSearchParams()

  // Arrival on a page, including the first load.
  useEffect(() => {
    drain()
  }, [pathname, search])

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined

    const stopWatching = () => {
      if (timer) clearInterval(timer)
      timer = undefined
    }
    const watch = () => {
      stopWatching()
      const until = Date.now() + WATCH_MS
      timer = setInterval(() => {
        if (drain() || Date.now() > until) stopWatching()
      }, WATCH_EVERY_MS)
    }

    const store = (window as { cookieStore?: EventTarget }).cookieStore
    const onChange = () => {
      drain()
    }

    document.addEventListener('submit', watch, true)
    window.addEventListener('focus', onChange)
    store?.addEventListener('change', onChange)

    return () => {
      stopWatching()
      document.removeEventListener('submit', watch, true)
      window.removeEventListener('focus', onChange)
      store?.removeEventListener('change', onChange)
    }
  }, [])

  return null
}
