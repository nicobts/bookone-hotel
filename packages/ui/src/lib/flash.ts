/**
 * Flash messages: the result of a server action, shown as a toast on the next
 * render (docs/conventions/UI_COMPONENTS.md, "Feedback").
 *
 * Almost every mutation here is a server action that ends in `redirect()` or
 * `revalidatePath()`, so there is no client code left running to call
 * `toast()`. The action writes the message into a short-lived cookie instead,
 * and `FlashToaster` (mounted once per app) turns it into a toast and deletes
 * it. Forms stay plain `<form action={…}>` and keep working without script.
 *
 * This file is the codec, shared by both sides. The writer is
 * `./flash-server.ts`; the reader is `components/flash-toaster.tsx`.
 *
 * Messages are already translated by the action and say what happened, never
 * who it happened to: a name or an email does not go into a cookie.
 */
export const FLASH_COOKIE = 'bo_flash'

export type FlashKind = 'success' | 'error' | 'info' | 'warning'

export type Flash = {
  id: string
  kind: FlashKind
  title: string
  description?: string
}

const KINDS: readonly FlashKind[] = ['success', 'error', 'info', 'warning']
/** A cookie is 4 KB at most; three short messages is all a page needs. */
const MAX_FLASHES = 3
const MAX_TITLE = 160
const MAX_DESCRIPTION = 320

export function encodeFlashes(flashes: Flash[]): string {
  return JSON.stringify(
    flashes.slice(-MAX_FLASHES).map((flash) => ({
      id: flash.id,
      kind: flash.kind,
      title: flash.title.slice(0, MAX_TITLE),
      ...(flash.description ? { description: flash.description.slice(0, MAX_DESCRIPTION) } : {}),
    })),
  )
}

/** Anything malformed decodes to nothing: a broken cookie must not break a page. */
export function decodeFlashes(raw: string | null | undefined): Flash[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  return parsed
    .flatMap((item: unknown): Flash[] => {
      if (typeof item !== 'object' || item === null) return []
      const { id, kind, title, description } = item as Record<string, unknown>
      if (typeof id !== 'string' || typeof title !== 'string' || !title) return []
      if (!KINDS.includes(kind as FlashKind)) return []
      return [
        {
          id: id.slice(0, 64),
          kind: kind as FlashKind,
          title: title.slice(0, MAX_TITLE),
          ...(typeof description === 'string' && description
            ? { description: description.slice(0, MAX_DESCRIPTION) }
            : {}),
        },
      ]
    })
    .slice(-MAX_FLASHES)
}
