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
 * Five years (ADR-041): the portal receipt is the property's proof that it
 * filed, and the Ministry keeps the filing itself for five years, so the proof
 * must last as long as the filing can be questioned. 5 × 365 + 2 covers any
 * five calendar years, leap days included. The file may show the party's
 * names, which is why it goes at all; the evidence keeps its hash after it goes.
 */
export const RECEIPT_RETENTION_DAYS = 1827

/**
 * Each upload gets its own key, under its property and obligation. A filing is
 * recorded once, but two people can submit at once, or a stale tab can submit
 * again: with a shared key the second upload would overwrite the recorded
 * receipt, and the cleanup after its refusal would delete it. Property first,
 * and no name or reference, because object keys turn up in logs.
 */
export function receiptPath(input: {
  propertyId: string
  obligationId: string
  uploadId: string
}): string {
  return `${input.propertyId}/${input.obligationId}/${input.uploadId}`
}
