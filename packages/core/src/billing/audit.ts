import { and, eq, gte, isNull, lt } from 'drizzle-orm'
import { asService } from '../db/session'
import { feeDisputes, feeEvents, reservations } from '../db/schema'
import { emit } from '../events'
import { agentActor } from '../events/actor'
import { attributeBookingIn } from './attribution'

/**
 * Re-checking what we billed (AG-07, 06 §2).
 *
 * The monthly report is the invoice, and the AI-attributed line is the one an
 * owner will argue about: it is the higher rate, the newer claim, and the place
 * where our interest and theirs diverge. This is what stops that being a matter
 * of trust.
 *
 * It re-runs D14's rule against `attribution_events` for every fee we billed at
 * the attributed rate, and asks one question: **does the evidence still support
 * this?**
 *
 * ## Why an unsupported fee is credited rather than flagged
 *
 * Because of what the two options actually mean. A flag creates a queue of
 * fees *we* believe are wrong, which somebody at our company works through at
 * our convenience while the property is invoiced for them. A credit is the
 * position D14 already commits us to — disputes resolve in the owner's favour —
 * applied before the owner has to notice.
 *
 * The direction matters and is the whole reason this is safe to automate: the
 * only action available here **reduces our own revenue**. An agent that could
 * only ever cost its operator money is an agent whose failure mode is a bad
 * quarter, not a defrauded customer.
 *
 * It should find nothing. Fees are computed from the same rule at confirmation,
 * so a finding means the two paths have diverged — which is precisely the thing
 * nobody would otherwise notice until an owner did.
 */

export interface AttributionFinding {
  feeEventId: string
  reservationId: string
  feeCents: number
  storedEvidence: Record<string, unknown>
  currentVerdict: string
  currentEvidence: Record<string, unknown>
}

export interface AttributionAuditReport {
  propertyId: string
  checked: number
  findings: AttributionFinding[]
  creditedCents: number
}

/**
 * Audit one property's attributed fees over a window.
 *
 * `credit` defaults to false so the check can be run and read before it is run
 * and acted on — the first time this points at real money, somebody should look
 * at what it says before it says it to an owner.
 */
export async function auditAttribution(input: {
  propertyId: string
  from: Date
  to: Date
  credit?: boolean
}): Promise<AttributionAuditReport> {
  return asService(async (db) => {
    const rows = await db
      .select({
        feeEventId: feeEvents.id,
        reservationId: feeEvents.reservationId,
        feeCents: feeEvents.feeCents,
        storedEvidence: feeEvents.evidence,
        createdAt: feeEvents.createdAt,
        conciergeSessionId: reservations.conciergeSessionId,
        engineSessionId: reservations.engineSessionId,
        disputeId: feeDisputes.id,
      })
      .from(feeEvents)
      .innerJoin(reservations, eq(reservations.id, feeEvents.reservationId))
      .leftJoin(feeDisputes, eq(feeDisputes.feeEventId, feeEvents.id))
      .where(
        and(
          eq(feeEvents.propertyId, input.propertyId),
          eq(feeEvents.kind, 'ai_attributed'),
          gte(feeEvents.createdAt, input.from),
          lt(feeEvents.createdAt, input.to),
          // Already credited. Crediting it twice would be an agent making the
          // same concession every night for the rest of the property's life.
          isNull(feeDisputes.id),
        ),
      )

    const findings: AttributionFinding[] = []

    for (const row of rows) {
      const verdict = await attributeBookingIn(db, {
        propertyId: input.propertyId,
        /*
         * The instant the rule was originally applied, taken from the evidence
         * chain — not the present, and not the fee row's `created_at`.
         *
         * Not the present, because the window is 24 hours before the *booking*:
         * re-running from now would look at an empty window for anything older
         * than a day and find every historic fee unsupported, crediting the
         * whole back catalogue on the first night.
         *
         * Not `created_at`, which is the subtler one and which this auditor
         * caught in its own codebase on the first clean-database run. The fee
         * path computes the verdict with `new Date()` *before* opening its
         * transaction; `fee_events.created_at` is the database's `now()`, set
         * milliseconds later. Two clocks, two instants — and the row's is
         * *earlier* than the concierge touch it was classified from. The window
         * closed before the evidence, the touch fell outside it, and every
         * attributed fee looked unsupported.
         *
         * The whole point of storing the chain is that a re-check asks the same
         * question. `bookedAt` is in it, so use it.
         */
        bookedAt: readBookedAt(row.storedEvidence, row.createdAt),
        conciergeSessionId: row.conciergeSessionId,
        engineSessionId: row.engineSessionId,
      })

      if (verdict.kind === 'ai_attributed') continue

      findings.push({
        feeEventId: row.feeEventId,
        reservationId: row.reservationId,
        feeCents: row.feeCents,
        storedEvidence: (row.storedEvidence ?? {}) as Record<string, unknown>,
        currentVerdict: verdict.kind,
        currentEvidence: verdict.evidence,
      })
    }

    let creditedCents = 0

    if (input.credit) {
      for (const finding of findings) {
        await db.transaction(async (tx) => {
          const [dispute] = await tx
            .insert(feeDisputes)
            .values({
              propertyId: input.propertyId,
              feeEventId: finding.feeEventId,
              // No `raisedBy`: nobody raised it. The property never had to
              // notice, which is the point.
              reason: `AG-07: the evidence for this attribution no longer holds — ${String(
                finding.currentEvidence.reason ?? 'reason unavailable',
              )}`,
              status: 'credited',
              creditCents: finding.feeCents,
              creditedAt: new Date(),
            })
            .onConflictDoNothing({ target: feeDisputes.feeEventId })
            .returning({ id: feeDisputes.id })

          if (!dispute) return

          creditedCents += finding.feeCents

          await emit(tx, {
            propertyId: input.propertyId,
            entityType: 'fee_dispute',
            entityId: dispute.id,
            eventType: 'fee.credited',
            origin: 'platform',
            actor: agentActor('AG-07'),
            payload: {
              feeEventId: finding.feeEventId,
              reservationId: finding.reservationId,
              creditCents: finding.feeCents,
              reason: finding.currentEvidence.reason ?? null,
            },
          })
        })
      }
    }

    return { propertyId: input.propertyId, checked: rows.length, findings, creditedCents }
  })
}

/**
 * The instant the rule was applied, from the stored chain.
 *
 * Falls back to the row's own timestamp for a fee written before the chain
 * carried one — those are Sprint 4 rows under the old proxy, and they should be
 * re-examined by a person rather than credited by a job.
 */
function readBookedAt(evidence: unknown, fallback: Date): Date {
  if (typeof evidence === 'object' && evidence !== null) {
    const stored = (evidence as Record<string, unknown>).bookedAt

    if (typeof stored === 'string') {
      const parsed = new Date(stored)
      if (!Number.isNaN(parsed.getTime())) return parsed
    }
  }

  return fallback
}

/** Properties with an attributed fee in the window — the auditor's work list. */
export async function propertiesWithAttributedFees(from: Date, to: Date): Promise<string[]> {
  const rows = await asService((db) =>
    db
      .selectDistinct({ propertyId: feeEvents.propertyId })
      .from(feeEvents)
      .where(
        and(
          eq(feeEvents.kind, 'ai_attributed'),
          gte(feeEvents.createdAt, from),
          lt(feeEvents.createdAt, to),
        ),
      ),
  )

  return rows.map((row) => row.propertyId)
}
