/**
 * Where identity documents live, and what they may be (E2.1, E2.4, D9).
 *
 * Constants only — no client, no SDK, no dependency. Core stays framework-free
 * (ADR-006 keeps supabase-js to Auth, Storage and Realtime, in the apps), and
 * two apps need these facts: the web app uploads and signs URLs, the worker
 * deletes.
 *
 * They live here because the alternative is each app carrying its own copy of a
 * bucket name and a path convention, and the first time one of them changed
 * would be the last time the deletion job found anything to delete.
 */

/** Created by the journey migration. Private; no policy for `authenticated`. */
export const DOCUMENT_BUCKET = 'identity-documents'

/** 10 MB, matching the bucket. A phone photo of a passport is 2–5 MB. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024

export const ALLOWED_DOCUMENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const

export type AllowedDocumentType = (typeof ALLOWED_DOCUMENT_TYPES)[number]

export function isAllowedDocumentType(value: string): value is AllowedDocumentType {
  return (ALLOWED_DOCUMENT_TYPES as readonly string[]).includes(value)
}

/**
 * Where one person's document lives.
 *
 * Property first, so a mis-scoped listing is visibly wrong rather than subtly
 * mixed. **No guest name and no document number** — an object key is not a
 * place to put personal data, because keys turn up in logs, in error messages
 * and in storage dashboards.
 *
 * Stable per guest per stay, so re-photographing a bad shot replaces it and the
 * deletion job has exactly one object to destroy per person.
 */
export function documentPath(input: {
  propertyId: string
  reservationId: string
  guestIndex: number
}): string {
  return `${input.propertyId}/${input.reservationId}/${input.guestIndex}`
}
