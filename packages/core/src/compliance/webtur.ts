import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm'
import { asService } from '../db/session'
import {
  complianceObligations,
  entitlements,
  properties,
  registrationRecords,
  reservations,
} from '../db/schema'
import { emit } from '../events'
import { systemActor } from '../events/actor'
import { zonedStartOfDay } from '../policy/booking-policy'
import type {
  ComplianceAdapter,
  ComplianceCapabilities,
  ManualFallback,
  ObligationInput,
  SubmitResult,
} from './adapter'
import { addDays, dailyMovement, type DayMovement, type MovementStay } from './istat'
import { csvCell } from './csv'
import type { ComplianceDeps, GenerateResult } from './obligations'
import { coverageFor, readJurisdiction, regionOf, resolveAdapters } from './registry'
import { localDate } from './reconcile'

/**
 * WebTur FVG as a ComplianceAdapter (WP1.3): the daily ISTAT movement return
 * for the region the registry assigns it to, one obligation per day, zero days
 * included.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  MOCKS ONLY. WP1.3 is blocked on the submission specification from the
 *  Regione (via the association's letter): whether WebTur has a machine
 *  interface at all, its coding, its deadline, its file format. What is built
 *  here does not depend on the answer: the series, the obligations, the
 *  desk's messages, the lifecycle, the fallback file, the comparison. The
 *  transport is a port (`IstatTransport`), today only the mock. Automating the
 *  portal's own pages is never done without the Regione's agreement (WP1.3
 *  "stop and ask").
 * ═══════════════════════════════════════════════════════════════════════════
 */
export const WEBTUR_FVG_ADAPTER_ID = 'webtur-fvg'

/**
 * How a day's return reaches the Regione. Idempotent per property and day: a
 * second submit of the same day returns the first reference, and a changed
 * day replaces the return (a correction), with a new reference.
 */
export interface IstatTransport {
  readonly channel: string
  readonly simulated: boolean
  submitDay(input: {
    propertyId: string
    day: string
    movement: DayMovement
  }): Promise<{ reference: string }>
  /** What the portal holds for a day, for the comparison. Null when it holds nothing. */
  readDay(input: { propertyId: string; day: string }): Promise<DayMovement | null>
}

export class IstatTransportError extends Error {
  constructor(
    readonly code: 'unavailable' | 'rejected' | 'unauthorized',
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'IstatTransportError'
  }
}

export function webturCapabilities(simulated: boolean): ComplianceCapabilities {
  return {
    id: WEBTUR_FVG_ADAPTER_ID,
    authority: 'regione-fvg',
    feature: 'istat_regional',
    // The region comes from the registry, never from code (ADR-028).
    jurisdiction: { level: 'region', code: regionOf(WEBTUR_FVG_ADAPTER_ID) ?? '' },
    obligationTypes: ['istat_movement'],
    transport: 'portal',
    evidenceType: 'receipt',
    retryPolicy: {
      maxAttempts: 5,
      backoffSeconds: 10 * 60,
      maxBackoffSeconds: 2 * 60 * 60,
      // A day's return is a short form: three hours is time enough by hand.
      manualBeforeDeadlineMinutes: 180,
    },
    manualFallback: {
      contentType: 'text/csv',
      description: "The day's arrivals, departures and presences by origin, for the portal.",
    },
    simulated,
  }
}

/**
 * When a day's return is due: the end of the following day, in the property's
 * zone. VERIFY with the Regione's specification.
 */
export function istatMovementDeadline(day: string, timeZone: string): Date {
  return zonedStartOfDay(addDays(day, 2), timeZone)
}

/** A day's key on the obligation (`compliance_obligations_subject_shape`). */
function subjectKeyFor(day: string): string {
  return `day:${day}`
}

/** The confirmed stays that touch a day range, with each recorded guest's origin. */
export async function loadMovementStays(
  propertyId: string,
  from: string,
  to: string,
): Promise<MovementStay[]> {
  return asService(async (db) => {
    const stays = await db
      .select({
        id: reservations.id,
        reference: reservations.reference,
        arrivalDate: reservations.arrivalDate,
        departureDate: reservations.departureDate,
        pax: reservations.pax,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          eq(reservations.status, 'confirmed'),
          lte(reservations.arrivalDate, to),
          gte(reservations.departureDate, from),
        ),
      )
      .orderBy(asc(reservations.arrivalDate))

    if (stays.length === 0) return []

    const records = await db
      .select({
        reservationId: registrationRecords.reservationId,
        guestIndex: registrationRecords.guestIndex,
        data: registrationRecords.data,
      })
      .from(registrationRecords)
      .where(
        and(
          eq(registrationRecords.propertyId, propertyId),
          inArray(
            registrationRecords.reservationId,
            stays.map((stay) => stay.id),
          ),
        ),
      )
      .orderBy(asc(registrationRecords.guestIndex))

    return stays.map((stay) => {
      const pax = (stay.pax ?? {}) as { adults?: unknown; children?: unknown }
      const count = (value: unknown) => (typeof value === 'number' && value > 0 ? value : 0)
      const text = (data: Record<string, unknown>, key: string) =>
        typeof data[key] === 'string' ? (data[key] as string) : null
      return {
        reference: stay.reference ?? stay.id.slice(0, 8),
        arrivalDate: stay.arrivalDate,
        departureDate: stay.departureDate,
        partySize: count(pax.adults) + count(pax.children),
        guests: records
          .filter((record) => record.reservationId === stay.id)
          .map((record) => {
            const data = (record.data ?? {}) as Record<string, unknown>
            return {
              residenceCountry: text(data, 'residenceCountry'),
              residenceProvince: text(data, 'residenceProvince'),
              citizenship: text(data, 'citizenship'),
            }
          }),
      }
    })
  })
}

/** One day's movement at one property. */
export async function movementForDay(propertyId: string, day: string): Promise<DayMovement> {
  const stays = await loadMovementStays(propertyId, day, day)
  return dailyMovement(stays, day, day)[0]!
}

/** Why a day went straight to a person: there is no channel to file it with. */
export const NO_CHANNEL = 'No channel to file this with yet: file it by hand.'

/**
 * Creates one `istat_movement` obligation per day, for every property whose
 * region owes one and which has the feature: from the day the feature was
 * switched on (at most a week back) to yesterday, in the property's zone.
 * Days with nobody get one too. Idempotent on the day.
 */
export async function generateIstatMovements(
  deps: ComplianceDeps,
  input: { propertyId?: string; now?: Date } = {},
): Promise<GenerateResult> {
  const now = input.now ?? deps.now?.() ?? new Date()
  const result: GenerateResult = { created: 0, rescheduled: 0, unsupported: [] }

  const candidates = await asService((db) =>
    db
      .select({
        propertyId: properties.id,
        settings: properties.settings,
        timeZone: properties.timezone,
        grantedAt: entitlements.grantedAt,
      })
      .from(properties)
      .innerJoin(
        entitlements,
        and(
          eq(entitlements.propertyId, properties.id),
          eq(entitlements.feature, 'istat_regional'),
          isNull(entitlements.endedAt),
        ),
      )
      .where(input.propertyId ? eq(properties.id, input.propertyId) : undefined),
  )

  for (const property of candidates) {
    const coverage = coverageFor(readJurisdiction(property.settings))
    const { resolved, missing } = resolveAdapters(coverage, deps.adapters, 'istat_movement')
    for (const entry of missing) {
      result.unsupported.push({ propertyId: property.propertyId, adapter: entry.adapter })
    }

    const yesterday = addDays(localDate(now, property.timeZone), -1)
    const weekAgo = addDays(yesterday, -6)
    const granted = localDate(property.grantedAt, property.timeZone)
    const first = granted > weekAgo ? granted : weekAgo

    // A region that owes a return but has no channel registered here (no
    // transport in production until the Regione's specification): each day is
    // still created, straight to a person, so its file and the form that
    // records it exist. Never queued: the sweep has nothing to send it with.
    const targets = [
      ...resolved.map(({ entry, adapter }) => ({
        entry,
        adapterId: adapter.capabilities().id,
        state: 'pending' as const,
        nextAttemptAt: now as Date | null,
        lastError: null as string | null,
      })),
      ...missing.map((entry) => ({
        entry,
        adapterId: entry.adapter,
        state: 'manual' as const,
        nextAttemptAt: null as Date | null,
        lastError: NO_CHANNEL as string | null,
      })),
    ]

    for (const { entry, adapterId, state, nextAttemptAt, lastError } of targets) {
      for (let day = first; day <= yesterday; day = addDays(day, 1)) {
        const deadline = istatMovementDeadline(day, property.timeZone)
        const created = await asService((db) =>
          db.transaction(async (tx) => {
            const [row] = await tx
              .insert(complianceObligations)
              .values({
                propertyId: property.propertyId,
                adapterId,
                authority: entry.authority,
                type: 'istat_movement',
                subjectKey: subjectKeyFor(day),
                periodDate: day,
                deadline,
                state,
                nextAttemptAt,
                lastError,
              })
              .onConflictDoNothing()
              .returning({ id: complianceObligations.id })
            if (!row) return false
            await emit(tx, {
              propertyId: property.propertyId,
              entityType: 'compliance_obligation',
              entityId: row.id,
              eventType: 'compliance_obligation.created',
              origin: 'platform',
              actor: systemActor,
              payload: {
                adapterId,
                type: 'istat_movement',
                day,
                deadline: deadline.toISOString(),
                ...(state === 'manual' ? { manual: true } : {}),
              },
            })
            return true
          }),
        )
        if (created) result.created += 1
      }
    }
  }

  return result
}

/** The day an obligation is for. */
function dayOf(obligation: ObligationInput): string {
  if (!obligation.periodDate) {
    throw new Error(`webtur: obligation ${obligation.obligationId} has no day`)
  }
  return obligation.periodDate
}

export function createWebturComplianceAdapter(transport: IstatTransport): ComplianceAdapter {
  return {
    capabilities: () => webturCapabilities(transport.simulated),

    async validate(obligation) {
      const movement = await movementForDay(obligation.propertyId, dayOf(obligation))
      if (movement.unknownIn.length === 0) return { ok: true }
      return {
        ok: false,
        issues: movement.unknownIn.map((reference) => ({
          code: 'origin-missing',
          field: 'citizenship',
          message: `Stay ${reference}: a guest's residence or citizenship is not recorded`,
        })),
      }
    },

    async submit(obligation): Promise<SubmitResult> {
      const day = dayOf(obligation)
      const movement = await movementForDay(obligation.propertyId, day)
      try {
        const { reference } = await transport.submitDay({
          propertyId: obligation.propertyId,
          day,
          movement,
        })
        return {
          status: 'acknowledged',
          reference,
          // Counts only: the receipt outlives everything else (ADR-039).
          receipt: {
            reference,
            day,
            channel: transport.channel,
            arrivals: movement.totals.arrivals,
            departures: movement.totals.departures,
            presences: movement.totals.presences,
            roomsOccupied: movement.roomsOccupied,
            simulated: transport.simulated,
          },
        }
      } catch (error) {
        if (error instanceof IstatTransportError) {
          return {
            status: 'failed',
            code: error.code,
            message: error.message,
            retryable: error.retryable,
          }
        }
        return { status: 'failed', code: 'unavailable', message: String(error), retryable: true }
      }
    },

    async manualFallback(obligation): Promise<ManualFallback> {
      return webturManualFallback(obligation.propertyId, dayOf(obligation))
    },
  }
}

/**
 * The day's return as a file to copy into the portal by hand. Semicolon CSV:
 * one line per origin, then the rooms occupied. VERIFY the portal's own form
 * with the first pilot; the steps describe the route, not button labels.
 */
export async function webturManualFallback(
  propertyId: string,
  day: string,
): Promise<ManualFallback> {
  const movement = await movementForDay(propertyId, day)
  const lines = [
    'giorno;provenienza;arrivi;partenze;presenze',
    ...Object.entries(movement.byOrigin)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(
        // The origin comes from what a guest typed: escaped, so it can neither
        // run as a spreadsheet formula nor break the columns.
        ([origin, counts]) =>
          `${day};${csvCell(origin)};${counts.arrivals};${counts.departures};${counts.presences}`,
      ),
    `${day};TOTALE;${movement.totals.arrivals};${movement.totals.departures};${movement.totals.presences}`,
    `${day};CAMERE_OCCUPATE;;;${movement.roomsOccupied}`,
  ]
  return {
    filename: `webtur-${day}.csv`,
    contentType: 'text/csv',
    content: `${lines.join('\r\n')}\r\n`,
    instructions: [
      'Accedi a WebTur con le credenziali della struttura.',
      `Apri il movimento del giorno ${day.split('-').reverse().join('/')}.`,
      movement.totals.presences === 0 && movement.totals.arrivals === 0
        ? 'Nessun ospite: dichiara la giornata a zero presenze.'
        : 'Inserisci arrivi, partenze e presenze per provenienza come nel file.',
      'Conferma e conserva la ricevuta: è la prova che la comunicazione è stata fatta.',
    ],
  }
}

/** One difference between what we reported and what the portal holds. */
export interface MovementDifference {
  origin: string
  field: 'arrivals' | 'departures' | 'presences' | 'roomsOccupied'
  ours: number
  theirs: number
}

/**
 * What BookOne reported for a day against what the portal shows (WP1.3's
 * reconciliation view). A difference usually means someone edited the day on
 * the portal after we filed, or the day changed after filing (a late stay).
 */
export async function compareIstatDay(
  transport: IstatTransport,
  input: { propertyId: string; day: string },
): Promise<{ theirs: 'missing' | 'present'; differences: MovementDifference[] }> {
  const ours = await movementForDay(input.propertyId, input.day)
  const theirs = await transport.readDay(input)
  if (!theirs) return { theirs: 'missing', differences: [] }

  const differences: MovementDifference[] = []
  const origins = new Set([...Object.keys(ours.byOrigin), ...Object.keys(theirs.byOrigin)])
  for (const origin of [...origins].sort()) {
    for (const field of ['arrivals', 'departures', 'presences'] as const) {
      const a = ours.byOrigin[origin]?.[field] ?? 0
      const b = theirs.byOrigin[origin]?.[field] ?? 0
      if (a !== b) differences.push({ origin, field, ours: a, theirs: b })
    }
  }
  if (ours.roomsOccupied !== theirs.roomsOccupied) {
    differences.push({
      origin: 'TOTALE',
      field: 'roomsOccupied',
      ours: ours.roomsOccupied,
      theirs: theirs.roomsOccupied,
    })
  }
  return { theirs: 'present', differences }
}
