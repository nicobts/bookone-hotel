/**
 * Where the receipts of manual filings live (WP1.6).
 *
 * Constants only, for the same reason as `documents.ts`: the web app uploads
 * and signs URLs, the worker deletes, and both must agree on the bucket and
 * the path.
 */

/** Created by the WP1.6 migration. Private; no policy for `authenticated`. */
export const RECEIPT_BUCKET = 'compliance-receipts'

/** 10 MB, matching the bucket. A portal receipt is a one-page PDF or a screenshot. */
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024

export const ALLOWED_RECEIPT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const

export function isAllowedReceiptType(value: string): boolean {
  return (ALLOWED_RECEIPT_TYPES as readonly string[]).includes(value)
}

/**
 * Two years, like the filing's own payload (`alloggiati_submissions`): the
 * file may show the party's names, and it should not outlive the filing it
 * proves. The evidence keeps the file's hash after it goes.
 */
export const RECEIPT_RETENTION_DAYS = 730

/**
 * One file per obligation: a filing is recorded once. Property first, and no
 * name or reference, because object keys turn up in logs.
 */
export function receiptPath(input: { propertyId: string; obligationId: string }): string {
  return `${input.propertyId}/${input.obligationId}`
}
