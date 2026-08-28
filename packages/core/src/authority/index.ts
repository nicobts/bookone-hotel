/**
 * The AuthorityMap and the write-router (ADR-001, D10, D12).
 *
 * The dual-source engine's decision procedure: for this property, in this
 * domain, who is authoritative — us or the PMS? Everything else in the sync
 * engine follows from the answer.
 *
 * Authority is configured *per domain per property*, stored on
 * `properties.authority_map`, and defaulted here. Graduation is a property
 * flipping one domain from `pms` to `platform`; it is not a migration, and that
 * is the whole thesis (ADR-001).
 */

/**
 * The domains authority can be held over.
 *
 * These map to rungs of the graduation ladder rather than to tables, because a
 * rung is what a property actually graduates. Adding one means deciding its
 * default below and adding a case to the exhaustive test.
 */
export const domains = [
  /** Rung 2 — the booking engine. Platform-authoritative from day one (D12). */
  'booking',
  /** Rung 3 — pre-arrival, documents, Alloggiati staging. */
  'journey',
  /** Guest records. Ours when the guest arrives through our surfaces. */
  'guests',
  /** Rung 5 — availability. Read-only from the PMS in V1. */
  'availability',
  /** Rung 5 — rates. Read-only from the PMS in V1. */
  'rates',
  /** Rung 4 — housekeeping. Not built; listed so the map is total. */
  'housekeeping',
  /** Rung 6 — gated by D11. Never ours, and enforced as such below. */
  'fiscal',
] as const

export type Domain = (typeof domains)[number]

/** Who writes. `platform` means we own it and reflect outward. */
export type Authority = 'platform' | 'pms'

export type AuthorityMap = Partial<Record<Domain, Authority>>

/**
 * V1 defaults, applied when a property's map says nothing about a domain.
 *
 * The booking domain is the one deliberate `platform` here: it is the first
 * domain we are authoritative for (D12), and the reason a property can adopt
 * the product without migrating anything.
 */
export const defaultAuthority: Record<Domain, Authority> = {
  booking: 'platform',
  journey: 'platform',
  guests: 'platform',
  availability: 'pms',
  rates: 'pms',
  housekeeping: 'pms',
  fiscal: 'pms',
}

/**
 * Domains no property may ever hold, whatever its map says.
 *
 * `fiscal` is gated behind D11's six conditions (ADR-002). A property row is
 * data — it can be edited in a dashboard, restored from a backup, or set by a
 * migration written in a hurry — so "we would never configure that" is not a
 * control. This is the control.
 */
const NEVER_PLATFORM: readonly Domain[] = ['fiscal']

export class FiscalAuthorityError extends Error {
  constructor() {
    super(
      'Fiscal authority cannot be granted to the platform. Gated by D11/ADR-002 ' +
        'until conditions C1-C6 are verified in writing.',
    )
    this.name = 'FiscalAuthorityError'
  }
}

/**
 * Who is authoritative for this domain at this property.
 *
 * The stored map is untrusted input: it is jsonb, so anything can be in it.
 * Unknown keys are ignored and unknown values fall back to the default, because
 * a typo in configuration must not silently move authority.
 */
export function resolveAuthority(map: unknown, domain: Domain): Authority {
  if (NEVER_PLATFORM.includes(domain)) return 'pms'

  const configured = readAuthority(map, domain)
  return configured ?? defaultAuthority[domain]
}

function readAuthority(map: unknown, domain: Domain): Authority | undefined {
  if (!map || typeof map !== 'object') return undefined

  const value = (map as Record<string, unknown>)[domain]
  return value === 'platform' || value === 'pms' ? value : undefined
}

/**
 * Where a write goes.
 *
 * `platform` — we are the source of truth. Write locally, emit the event, and
 *   queue a reflection to the PMS so it stays in step. A reflection that fails
 *   is an exception the owner sees, not a lost write (PRD A3).
 *
 * `pms` — they are the source of truth. The write goes to them first and comes
 *   back to us through sync. Writing locally would create a second truth, which
 *   is exactly the failure the dual-source architecture exists to prevent.
 */
export interface WriteRoute {
  authority: Authority
  /** Write to our tables first. */
  writeLocal: boolean
  /** Queue `reservation.reflect` (or the domain's equivalent) afterwards. */
  reflectToPms: boolean
  /** Send to the PMS and wait for sync to bring it back. */
  writeThroughToPms: boolean
}

export function routeWrite(map: unknown, domain: Domain): WriteRoute {
  const authority = resolveAuthority(map, domain)

  return authority === 'platform'
    ? { authority, writeLocal: true, reflectToPms: true, writeThroughToPms: false }
    : { authority, writeLocal: false, reflectToPms: false, writeThroughToPms: true }
}

/**
 * Validates a map before it is stored.
 *
 * Called on the settings path. Rejects fiscal outright and drops unknown keys
 * rather than persisting them: an unknown key is either a typo, which should be
 * reported, or a domain from a future version, which this code cannot honour
 * and must not appear to.
 */
export function validateAuthorityMap(input: unknown): AuthorityMap {
  if (!input || typeof input !== 'object') return {}

  const entries = Object.entries(input as Record<string, unknown>)
  const validated: AuthorityMap = {}

  for (const [key, value] of entries) {
    if (!domains.includes(key as Domain)) continue

    const domain = key as Domain
    if (value !== 'platform' && value !== 'pms') continue

    if (value === 'platform' && NEVER_PLATFORM.includes(domain)) {
      throw new FiscalAuthorityError()
    }

    validated[domain] = value
  }

  return validated
}
