import 'server-only'
import { createClient } from '@supabase/supabase-js'

/**
 * Identity documents in EU Storage (E2.1, D9).
 *
 * The only module that touches the `identity-documents` bucket, and it is
 * deliberately small.
 *
 * ## Why the service role, and why that is not a shortcut
 *
 * The bucket is private and has no policy granting the `authenticated` role
 * anything, because the people whose documents these are hold no account
 * (ADR-007) — they are travelling companions of somebody who booked. So there
 * is no session to authorise, and the boundary has to be server-side code: the
 * signed stay token resolves to exactly one reservation, and everything below
 * writes under a path derived from that reservation and nothing else.
 *
 * The path is the containment. A caller cannot ask this module to write
 * somewhere else, because it does not take a path — it takes a property, a
 * reservation and a guest index, and builds one.
 *
 * ## What is deliberately absent
 *
 * No public URL, ever. The console reads a document through a short-lived
 * signed URL minted here; a browser never holds a durable link to a passport
 * photograph.
 */

/** Matches the bucket created in the journey migration. */
const BUCKET = 'identity-documents'

/** 10 MB, matching the bucket. A phone photo of a passport is 2–5 MB. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024

export const ALLOWED_DOCUMENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) return null

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export type UploadOutcome =
  | { status: 'stored'; path: string }
  | { status: 'rejected'; reason: 'too-large' | 'wrong-type' | 'empty' }
  | { status: 'failed'; reason: string }

/**
 * Stores one document.
 *
 * Overwrites deliberately (`upsert`): a guest who photographs their passport
 * badly and tries again should replace the bad photo, not accumulate both. The
 * path is stable per guest per stay, so there is exactly one object per person
 * and the retention job (E2.4) has exactly one thing to delete.
 */
export async function storeIdentityDocument(input: {
  propertyId: string
  reservationId: string
  guestIndex: number
  file: File
}): Promise<UploadOutcome> {
  const { file } = input

  if (file.size === 0) return { status: 'rejected', reason: 'empty' }
  if (file.size > MAX_DOCUMENT_BYTES) return { status: 'rejected', reason: 'too-large' }

  // Checked here as well as on the bucket. The bucket is the boundary that
  // cannot be bypassed; this one produces a message a guest can act on rather
  // than a storage error they cannot.
  if (!ALLOWED_DOCUMENT_TYPES.includes(file.type as (typeof ALLOWED_DOCUMENT_TYPES)[number])) {
    return { status: 'rejected', reason: 'wrong-type' }
  }

  const supabase = client()
  if (!supabase) return { status: 'failed', reason: 'storage is not configured' }

  const path = documentPath(input)

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type })

  if (error) return { status: 'failed', reason: error.message }

  return { status: 'stored', path }
}

/**
 * A link the console can open, valid for minutes.
 *
 * Short-lived on purpose: a desk clerk needs to look at a document once, and a
 * URL that outlives that need is a URL that ends up in a browser history, a
 * chat message or a screenshot.
 */
export async function signedDocumentUrl(path: string, seconds = 120): Promise<string | null> {
  const supabase = client()
  if (!supabase) return null

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, seconds)

  return error ? null : (data?.signedUrl ?? null)
}

/**
 * Destroys a document (E2.4).
 *
 * Here rather than in core because core does not know what a bucket is — it
 * records that the deletion happened. The retention job in Sprint 6 calls this
 * and then stamps the row.
 */
export async function deleteIdentityDocument(path: string): Promise<boolean> {
  const supabase = client()
  if (!supabase) return false

  const { error } = await supabase.storage.from(BUCKET).remove([path])

  return !error
}

/**
 * Where one person's document lives.
 *
 * Property first, so a mis-scoped listing is visibly wrong rather than subtly
 * mixed. No guest name and no document number in the path — an object key is
 * not a place to put personal data, because keys turn up in logs.
 */
function documentPath(input: {
  propertyId: string
  reservationId: string
  guestIndex: number
}): string {
  return `${input.propertyId}/${input.reservationId}/${input.guestIndex}`
}
