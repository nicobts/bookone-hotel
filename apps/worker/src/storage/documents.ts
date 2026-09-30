import { createClient } from '@supabase/supabase-js'
import { DOCUMENT_BUCKET } from '@bookone/core/storage'
import type { Logger } from 'pino'

/**
 * Destroying identity documents (E2.4).
 *
 * The worker's half of storage: it only ever deletes. Uploading and signing
 * URLs happen in `apps/web`, because that is where a guest and a desk clerk
 * are. Each app constructs its own client; the bucket name and path convention
 * live in `@bookone/core/storage` so they cannot drift apart.
 *
 * Returns whether the object is actually gone. The caller stamps the row only
 * on true — a row claiming deletion over a file that still exists is a lie the
 * product would then repeat to a supervisory authority.
 */
export function createDocumentDeleter(
  logger: Logger,
  bucket: string = DOCUMENT_BUCKET,
): (path: string) => Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    // Loud, and returns false forever. Silently succeeding would mark documents
    // deleted that were never touched, which is the one failure this feature
    // exists to prevent.
    logger.error({ bucket }, 'storage is not configured; stored files cannot be deleted')

    return () => Promise.resolve(false)
  }

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  return async (path: string) => {
    const { error } = await client.storage.from(bucket).remove([path])

    if (error) {
      logger.warn({ bucket, path, error: error.message }, 'could not delete a stored file')

      return false
    }

    return true
  }
}

/**
 * Reads one identity document from the private bucket, for the extraction job
 * (WP0.4). Base64 in memory, handed to the model provider and dropped — never
 * written anywhere else, never logged.
 */
export function createDocumentReader(
  logger: Logger,
): (path: string) => Promise<{ mediaType: string; data: string } | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    logger.error('storage is not configured; identity documents cannot be read')
    return () => Promise.resolve(null)
  }

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  return async (path: string) => {
    const { data, error } = await client.storage.from(DOCUMENT_BUCKET).download(path)

    if (error || !data) {
      logger.warn({ path, error: error?.message }, 'could not read an identity document')
      return null
    }

    return {
      mediaType: data.type || 'application/octet-stream',
      data: Buffer.from(await data.arrayBuffer()).toString('base64'),
    }
  }
}
