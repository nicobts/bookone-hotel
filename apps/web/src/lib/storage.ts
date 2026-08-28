import 'server-only'
import { createClient } from '@supabase/supabase-js'
import {
  ALLOWED_DOCUMENT_TYPES,
  DOCUMENT_BUCKET,
  documentPath,
  isAllowedDocumentType,
  MAX_DOCUMENT_BYTES,
} from '@bookone/core/storage'

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

// The bucket name, the size cap, the allowed types and the path convention all
// come from `@bookone/core/storage`. The worker deletes from the same bucket,
// and two copies of a path convention is one deletion job that finds nothing.
export { ALLOWED_DOCUMENT_TYPES, MAX_DOCUMENT_BYTES }

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
  if (!isAllowedDocumentType(file.type)) {
    return { status: 'rejected', reason: 'wrong-type' }
  }

  const supabase = client()
  if (!supabase) return { status: 'failed', reason: 'storage is not configured' }

  const path = documentPath(input)

  const { error } = await supabase.storage
    .from(DOCUMENT_BUCKET)
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

  const { data, error } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUrl(path, seconds)

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

  const { error } = await supabase.storage.from(DOCUMENT_BUCKET).remove([path])

  return !error
}
