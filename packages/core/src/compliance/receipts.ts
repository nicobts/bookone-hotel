import { and, asc, eq, isNull, lt } from 'drizzle-orm'
import { asService } from '../db/session'
import { complianceAttachments } from '../db/schema'
import { emit } from '../events'
import { systemActor } from '../events/actor'
import { RECEIPT_RETENTION_DAYS } from '../storage/receipts'

/**
 * The five-year purge (ADR-041) of manual-filing receipt files (WP1.6, data map).
 *
 * The file goes; the row and the evidence stay, and the evidence receipt holds
 * the file's SHA-256, so the filing is still proven. A row is stamped only
 * when the object is actually gone: a row claiming a deletion over a file that
 * still exists is a statement the property would repeat to an authority.
 */
export async function purgeReceiptFiles(
  deps: { deleteObject: (path: string) => Promise<boolean> },
  options: { now?: Date; limit?: number } = {},
): Promise<{ deleted: number; failed: number }> {
  const now = options.now ?? new Date()
  const cutoff = new Date(now.getTime() - RECEIPT_RETENTION_DAYS * 86_400_000)

  const due = await asService((db) =>
    db
      .select({
        id: complianceAttachments.id,
        propertyId: complianceAttachments.propertyId,
        obligationId: complianceAttachments.obligationId,
        path: complianceAttachments.path,
      })
      .from(complianceAttachments)
      .where(
        and(isNull(complianceAttachments.deletedAt), lt(complianceAttachments.uploadedAt, cutoff)),
      )
      .orderBy(asc(complianceAttachments.uploadedAt))
      .limit(options.limit ?? 200),
  )

  let deleted = 0
  let failed = 0
  for (const row of due) {
    if (!(await deps.deleteObject(row.path))) {
      failed += 1
      continue
    }
    await asService((db) =>
      db.transaction(async (tx) => {
        await tx
          .update(complianceAttachments)
          .set({ deletedAt: now })
          .where(
            and(
              eq(complianceAttachments.id, row.id),
              eq(complianceAttachments.propertyId, row.propertyId),
            ),
          )
        await emit(tx, {
          propertyId: row.propertyId,
          entityType: 'compliance_obligation',
          entityId: row.obligationId,
          eventType: 'compliance_attachment.deleted',
          origin: 'platform',
          actor: systemActor,
          payload: { attachmentId: row.id, reason: 'retention' },
        })
      }),
    )
    deleted += 1
  }
  return { deleted, failed }
}
