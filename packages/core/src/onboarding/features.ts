import { sql, type AnyColumn, type SQL } from 'drizzle-orm'
import { entitlements } from '../db/schema'
import type { JobName } from '../jobs'
import { listEntitlements, type Feature } from './entitlements'

/**
 * Feature gating (ADR-019).
 *
 * Entitlements are the flag store; this file is how code asks them. "Off" means
 * the property cannot reach the module — not that the module is unregistered.
 * One worker process and one Next.js build serve every property, so a route
 * cannot be absent for one hotel and present for another. What can be true is
 * that every door into it answers 404 for a property without the feature, and
 * that no job does that property's work.
 *
 * `core` is the explicit other answer: the platform itself (auth, health,
 * reservations, privacy), and every job that *finishes* an obligation already
 * in flight. Those are never gated, because turning a module off must not
 * strand a guest's paid deposit, a filing awaiting acknowledgement, or an
 * identity document awaiting deletion.
 */
export type Gate = Feature | 'core'

/** Asks whether one property has one feature. */
export type FeatureCheck = (propertyId: string, feature: Feature) => Promise<boolean>

/**
 * The features the Guest Desk Phase 0 demo property runs with (plan §2).
 *
 * `pms_sync` is "per pilot" in the matrix and `booking_engine` is off for hotel
 * properties, so neither is here; a pilot on Ericsoft is granted `pms_sync` on
 * its own. `alloggiati` is off until Phase 1.
 */
export const PHASE0_FEATURES = [
  'inbox',
  'concierge',
  'prearrival',
  'payments',
] as const satisfies readonly Feature[]

/**
 * Every job, classified.
 *
 * A `Record` over `JobName`, so adding a job without deciding its gate fails to
 * compile — the leak ADR-019 names is a job nobody classified.
 *
 * A job with a feature is skipped for a property without it: by the worker's
 * wrapper when the payload names a property, inside the loop when it is a
 * cross-property sweep.
 */
export const JOB_FEATURE: Record<JobName, Gate> = {
  'availability.refresh': 'pms_sync',
  'reservation.reflect': 'pms_sync',
  'reconcile.nightly': 'pms_sync',
  // Gated per agent by the runner, which knows which agent it is running.
  'agent.run': 'core',
  'notification.send': 'core',
  'notification.sweep': 'core',
  // Cleanup: a hold that expires frees nothing a module owns.
  'reservation.expire_holds': 'core',
  // Finishes money already in flight. Never stranded by a flag.
  'payment.replay': 'core',
  'precheckin.sweep': 'prearrival',
  'precheckin.invite': 'prearrival',
  'alloggiati.file': 'alloggiati',
  // Finishes a filing already made.
  'alloggiati.check': 'core',
  // Deletes identity documents. Privacy work is never switched off.
  'documents.purge': 'core',
  'documents.extract': 'document_ocr',
  'complaints.sla': 'inbox',
  'concierge.reply': 'concierge',
  'escalation.sweep': 'inbox',
  'arrival.complete': 'core',
  // The guest asked; routing the request to the property is not a module.
  'invoice.route': 'core',
  'departure.sweep': 'core',
  // Audits what was already said to guests. A safety check does not stop
  // because the agent that said it was switched off yesterday.
  'toolboundary.audit': 'core',
  'attribution.audit': 'core',
  'report.generate': 'core',
  'onboarding.ingest': 'core',
  'privacy.erase': 'core',
  'retention.sweep': 'core',
  'schedules.sync': 'core',
}

/**
 * A check that reads each property's entitlements once.
 *
 * Create one per request or per job run. Long-lived memoisation would make a
 * revoke take effect "eventually", which is the same as not at all for the
 * person who just revoked it.
 */
export function createFeatureCheck(
  load: (propertyId: string) => Promise<string[]> = listEntitlements,
): FeatureCheck {
  const loaded = new Map<string, Promise<Set<string>>>()

  return async (propertyId, feature) => {
    let features = loaded.get(propertyId)

    if (!features) {
      features = load(propertyId).then((rows) => new Set(rows))
      loaded.set(propertyId, features)
    }

    return (await features).has(feature)
  }
}

/**
 * A `where` condition: the property in `column` has `feature` live.
 *
 * For batched cross-property sweeps. Filtering after a `limit` would let rows
 * from properties without the feature hold every slot in the batch, forever —
 * they never get processed, so they never stop being due — and starve the
 * properties that do have it.
 */
export function hasFeatureSql(column: AnyColumn, feature: Feature): SQL {
  return sql`exists (select 1 from ${entitlements} where ${entitlements.propertyId} = ${column} and ${entitlements.feature} = ${feature} and ${entitlements.endedAt} is null)`
}

/** Whether a gate is open for a property. `core` always is. */
export async function gateOpen(
  check: FeatureCheck,
  propertyId: string,
  gate: Gate,
): Promise<boolean> {
  return gate === 'core' ? true : check(propertyId, gate)
}
