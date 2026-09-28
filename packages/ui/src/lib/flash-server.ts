import { cookies } from 'next/headers'
import { FLASH_COOKIE, decodeFlashes, encodeFlashes, type FlashKind } from './flash'

/**
 * Queue a toast for the next render, from a server action (see `./flash.ts`).
 *
 *   await flash.success(t('approved'))
 *   redirect(page)
 *
 * Call it before `redirect()`, which throws. The cookie is readable by script
 * because the reader is client code, and lives a minute: long enough to
 * survive a slow redirect, short enough that a message never turns up on a
 * page visited much later.
 */
async function push(kind: FlashKind, title: string, description?: string) {
  const jar = await cookies()
  const queued = decodeFlashes(jar.get(FLASH_COOKIE)?.value)
  queued.push({
    id: crypto.randomUUID(),
    kind,
    title,
    ...(description ? { description } : {}),
  })
  jar.set(FLASH_COOKIE, encodeFlashes(queued), {
    path: '/',
    maxAge: 60,
    sameSite: 'lax',
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
  })
}

export const flash = {
  success: (title: string, description?: string) => push('success', title, description),
  error: (title: string, description?: string) => push('error', title, description),
  info: (title: string, description?: string) => push('info', title, description),
  warning: (title: string, description?: string) => push('warning', title, description),
}
