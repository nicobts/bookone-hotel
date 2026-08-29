import { auditAttribution } from '@bookone/core/billing'
import type { Tool } from './index'

/**
 * AG-07's tools (06 §2, Sprint 8).
 *
 * Two of them, and what is missing matters more than what is here: there is no
 * tool that raises a fee, reclassifies a booking upward, or edits an issued
 * report. The auditor can only ever cost its operator money, which is the
 * asymmetry that makes a T1 agent acting alone on billing defensible at all.
 *
 * Fiscal-adjacent tools do not exist and will not (D11, ADR-011). Not gated:
 * absent.
 */

/** Windows are read from the input so a run can be replayed over a stated period. */
function readWindow(input: Record<string, unknown>): { from: Date; to: Date } | null {
  const from = typeof input.from === 'string' ? new Date(input.from) : null
  const to = typeof input.to === 'string' ? new Date(input.to) : null

  if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null
  if (from >= to) return null

  return { from, to }
}

/**
 * Re-run D14's rule over what we billed, and report.
 *
 * Read-only. Separate from the crediting tool on purpose: the check and the
 * concession are different acts, and an operator should be able to run the
 * first for a while before granting the second.
 */
export const auditAttributionTool: Tool = {
  name: 'audit_attribution',
  description: 'Re-check AI-attributed fees against their evidence chain',

  run: async (context, input) => {
    const window = readWindow(input)
    if (!window) return { ok: false, output: { error: 'from and to are required ISO dates' } }

    const report = await auditAttribution({
      propertyId: context.propertyId,
      from: window.from,
      to: window.to,
      credit: false,
    })

    return {
      ok: true,
      output: {
        checked: report.checked,
        findings: report.findings.length,
        // The detail, not a count. An auditor whose output is a number is one
        // whose findings nobody can check — which is the failure this agent
        // exists to prevent in the first place.
        details: report.findings.map((finding) => ({
          feeEventId: finding.feeEventId,
          reservationId: finding.reservationId,
          feeCents: finding.feeCents,
          reason: finding.currentEvidence.reason ?? null,
        })),
        // Deterministic: this is a documented rule re-run over timestamps, not
        // an inference. Reporting a hedged number would make the tier threshold
        // meaningless for every agent that comes after (see AG-05).
        confidence: 1,
      },
    }
  },
}

/**
 * Credit a fee whose evidence no longer holds.
 *
 * The only write AG-07 has, and it moves money in exactly one direction.
 * Idempotent through the unique constraint on `fee_disputes.fee_event_id`: an
 * auditor that ran twice must not make the same concession twice.
 */
export const creditUnevidencedFeeTool: Tool = {
  name: 'credit_unevidenced_fee',
  description: 'Credit AI-attributed fees whose evidence no longer supports them',

  run: async (context, input) => {
    const window = readWindow(input)
    if (!window) return { ok: false, output: { error: 'from and to are required ISO dates' } }

    const report = await auditAttribution({
      propertyId: context.propertyId,
      from: window.from,
      to: window.to,
      credit: true,
    })

    return {
      ok: true,
      output: {
        checked: report.checked,
        credited: report.findings.length,
        creditedCents: report.creditedCents,
        details: report.findings.map((finding) => ({
          feeEventId: finding.feeEventId,
          feeCents: finding.feeCents,
          reason: finding.currentEvidence.reason ?? null,
        })),
        confidence: 1,
      },
    }
  },
}

export const billingTools: Tool[] = [auditAttributionTool, creditUnevidencedFeeTool]
