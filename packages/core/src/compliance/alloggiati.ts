import type { AlloggiatiAdapter } from '../alloggiati/adapter'
import {
  buildAlloggiatiFile,
  readAlloggiatiFiling,
  refreshAlloggiatiAcknowledgement,
  stageAlloggiati,
  submitAlloggiati,
} from '../alloggiati/submit'
import type { ValidationIssue } from '../alloggiati/record'
import { getSchedinaPreview } from '../journey/confirm'
import type {
  ComplianceAdapter,
  ComplianceCapabilities,
  ComplianceIssue,
  ManualFallback,
  ObligationInput,
  SubmitResult,
} from './adapter'

/**
 * Alloggiati Web as a ComplianceAdapter (ADR-026: the first implementation).
 *
 * A bridge, not a rewrite. The Sprint 6 chain — staging, the one-row-per-stay
 * trail in `alloggiati_submissions`, the journey's `alloggiati` dimension, the
 * reference in `external_refs` — stays exactly as it is and keeps its tests.
 * This file maps it onto the four methods:
 *
 * - `validate`: the schedina is complete **and a person has confirmed it**
 *   against the documents (WP0.4). The lifecycle never files a record nobody
 *   looked at; an unconfirmed stay waits, and near the deadline goes to a
 *   person.
 * - `submit`: stage (idempotent) and file. When the stay is already filed it
 *   asks the channel instead (`refreshAlloggiatiAcknowledgement`) — the
 *   idempotent submit ADR-039 relies on. The Sprint 6 code already refuses to
 *   re-file a stay, so a duplicate schedina cannot come from here.
 * - `manualFallback`: the same fixed-width file, built from the same records,
 *   for the portal's upload page.
 *
 * MEMO: the only `AlloggiatiAdapter` outside production is the mock; nothing is
 * filed with the Questura (04 §0 item 5, WP1.2).
 */
export const ALLOGGIATI_ADAPTER_ID = 'alloggiati'

export function alloggiatiCapabilities(simulated: boolean): ComplianceCapabilities {
  return {
    id: ALLOGGIATI_ADAPTER_ID,
    authority: 'questura',
    feature: 'alloggiati',
    jurisdiction: { level: 'national', country: 'IT' },
    obligationTypes: ['guest_registration'],
    transport: 'web_service',
    evidenceType: 'receipt',
    retryPolicy: {
      maxAttempts: 5,
      backoffSeconds: 5 * 60,
      maxBackoffSeconds: 60 * 60,
      // WP1.2: escalation at T−2h. Two hours is enough for a receptionist to
      // upload the file by hand; less is a promise nobody can keep at night.
      manualBeforeDeadlineMinutes: 120,
    },
    manualFallback: {
      contentType: 'text/plain',
      description: "The fixed-width file for Alloggiati Web's file upload, one line per guest.",
    },
    simulated,
  }
}

function issuesFrom(issues: ValidationIssue[]): ComplianceIssue[] {
  return issues.map((issue) => ({
    code: 'incomplete',
    field: issue.field,
    message: `Guest ${issue.guestIndex + 1}: ${issue.field} — ${issue.problem}`,
  }))
}

export function createAlloggiatiComplianceAdapter(port: AlloggiatiAdapter): ComplianceAdapter {
  function stayOf(obligation: ObligationInput): string {
    if (!obligation.reservationId) {
      throw new Error(`alloggiati: obligation ${obligation.obligationId} has no stay`)
    }
    return obligation.reservationId
  }

  return {
    capabilities: () => alloggiatiCapabilities(port.simulated),

    async validate(obligation) {
      const reservationId = stayOf(obligation)
      const preview = await getSchedinaPreview(obligation.propertyId, reservationId)

      if (!preview) {
        return {
          ok: false,
          issues: [{ code: 'unknown-stay', message: 'The stay no longer exists.' }],
        }
      }
      if (!preview.ready) return { ok: false, issues: issuesFrom(preview.issues) }
      if (!preview.confirmedAt) {
        return {
          ok: false,
          issues: [
            {
              code: 'not-confirmed',
              message: 'Nobody has confirmed the guests against their documents yet.',
            },
          ],
        }
      }
      return { ok: true }
    },

    async submit(obligation): Promise<SubmitResult> {
      const reservationId = stayOf(obligation)
      const key = { propertyId: obligation.propertyId, reservationId }

      const existing = await readAlloggiatiFiling({ ...key, channel: port.channel })

      if (existing?.status === 'submitted') {
        // Filed already: ask, never re-send.
        const answer = await refreshAlloggiatiAcknowledgement({ adapter: port }, key)
        if (answer === 'failed') {
          return {
            status: 'failed',
            code: 'check-failed',
            message: 'The channel could not say whether the filing was accepted.',
            retryable: true,
          }
        }
        return answerFor(await readAlloggiatiFiling({ ...key, channel: port.channel }))
      }

      if (existing?.status === 'acknowledged') return answerFor(existing)

      const staged = await stageAlloggiati({ ...key, channel: port.channel })
      if (staged.status === 'incomplete') {
        return {
          status: 'failed',
          code: 'incomplete',
          message: issuesFrom(staged.issues)
            .map((issue) => issue.message)
            .join(' · '),
          retryable: false,
        }
      }
      if (staged.status === 'rejected') {
        return { status: 'failed', code: 'rejected', message: staged.reason, retryable: false }
      }

      const filed = await submitAlloggiati({ adapter: port }, key)
      if (filed.status === 'failed') {
        return {
          status: 'failed',
          code: filed.retryable ? 'unavailable' : 'rejected',
          message: filed.reason,
          retryable: filed.retryable,
        }
      }
      if (filed.status === 'nothing-staged') {
        return {
          status: 'failed',
          code: 'nothing-staged',
          message: 'Nothing was staged to file.',
          retryable: true,
        }
      }

      return answerFor(await readAlloggiatiFiling({ ...key, channel: port.channel }))
    },

    async manualFallback(obligation): Promise<ManualFallback> {
      return alloggiatiManualFallback({
        propertyId: obligation.propertyId,
        reservationId: stayOf(obligation),
      })
    },
  }
}

function answerFor(filing: Awaited<ReturnType<typeof readAlloggiatiFiling>>): SubmitResult {
  if (!filing || !filing.reference) {
    return {
      status: 'failed',
      code: 'no-reference',
      message: 'The channel returned no reference for the filing.',
      retryable: true,
    }
  }
  if (filing.status === 'acknowledged' && filing.receipt) {
    return { status: 'acknowledged', reference: filing.reference, receipt: filing.receipt }
  }
  return { status: 'submitted', reference: filing.reference }
}

/**
 * The manual fallback, on its own: it needs no channel, so the console can
 * build it where no adapter is running (apps/web).
 *
 * The steps are in Italian on purpose: the Questura's portal exists only in
 * Italian, and a translated step pointing at a label that does not say that is
 * worse than none. They describe the route rather than quoting button labels,
 * which are to be verified against the portal with the first pilot
 * (`docs/runbooks/compliance-manual-fallback.md`).
 */
export async function alloggiatiManualFallback(input: {
  propertyId: string
  reservationId: string
}): Promise<ManualFallback> {
  const built = await buildAlloggiatiFile(input)

  if (built.status !== 'ready') {
    const missing =
      built.status === 'incomplete'
        ? issuesFrom(built.issues).map((issue) => issue.message)
        : ['The stay no longer exists.']
    throw new ManualFallbackUnavailable(missing)
  }

  return {
    filename: `alloggiati-${built.arrivalDate}-${input.reservationId.slice(0, 8)}.txt`,
    contentType: 'text/plain',
    content: built.content,
    instructions: [
      'Accedi ad Alloggiati Web (alloggiatiweb.poliziadistato.it) con le credenziali della struttura.',
      "Nella sezione per l'invio delle schedine scegli l'invio tramite file.",
      `Carica questo file (${built.guestCount} ${built.guestCount === 1 ? 'riga' : 'righe'}, una per ospite) e conferma l'invio.`,
      'Scarica la ricevuta e conservala: è la prova che la comunicazione è stata fatta.',
    ],
  }
}

/** The fallback cannot be built: the record is incomplete. Each reason is a sentence. */
export class ManualFallbackUnavailable extends Error {
  constructor(readonly reasons: string[]) {
    super(`manual fallback unavailable: ${reasons.join('; ')}`)
    this.name = 'ManualFallbackUnavailable'
  }
}
