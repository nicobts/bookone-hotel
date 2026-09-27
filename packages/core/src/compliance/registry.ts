import { z } from 'zod'
import data from './registry.json'
import type { ComplianceAdapter, ObligationType } from './adapter'

/**
 * The region registry (ADR-028, ADR-039): which authorities a property owes,
 * from where it is.
 *
 * The data is `registry.json`. This file reads it and validates it at load,
 * so a malformed entry stops the process rather than silently dropping an
 * obligation. No function here takes a region name and branches on it.
 */

const entrySchema = z.object({
  adapter: z.string().min(1),
  authority: z.string().min(1),
  obligation: z.enum(['guest_registration', 'istat_movement', 'tourist_tax_declaration']),
})

const registrySchema = z.object({
  national: z.array(entrySchema),
  regions: z.record(
    z.string().regex(/^IT-\d{2}$/),
    z.object({
      name: z.string(),
      regional: z.array(entrySchema),
      comuni: z.record(
        z.string().regex(/^\d{6}$/),
        z.object({ name: z.string(), municipal: z.array(entrySchema) }),
      ),
    }),
  ),
})

export type RegistryEntry = z.infer<typeof entrySchema> & {
  level: 'national' | 'region' | 'comune'
}
export type Registry = z.infer<typeof registrySchema>

export const REGISTRY: Registry = registrySchema.parse(data)

/**
 * Where a property is: `settings.jurisdiction`. Region as ISO 3166-2
 * (e.g. `IT-` and two digits), comune as its ISTAT code (six digits).
 */
export const jurisdictionSchema = z.object({
  region: z.string().regex(/^IT-\d{2}$/),
  comune: z.string().regex(/^\d{6}$/),
})

export type PropertyJurisdiction = z.infer<typeof jurisdictionSchema>

/** A property's jurisdiction from its settings, or null when it has none or it is malformed. */
export function readJurisdiction(settings: unknown): PropertyJurisdiction | null {
  const raw =
    settings !== null && typeof settings === 'object'
      ? (settings as Record<string, unknown>).jurisdiction
      : undefined
  const parsed = jurisdictionSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

export interface Coverage {
  /** Every obligation the property owes, from the registry. */
  entries: RegistryEntry[]
  /** False when the region is not in the registry: its regional return is manual (ADR-028). */
  regionKnown: boolean
  /** False when the comune is not in the registry: its municipal return is manual. */
  comuneKnown: boolean
}

/**
 * What a property owes, from where it is.
 *
 * The national entries apply to every property, a jurisdiction or not — a
 * guest must be registered with the Questura wherever the house is. The
 * regional and municipal ones need the jurisdiction and a registry entry.
 */
export function coverageFor(
  jurisdiction: PropertyJurisdiction | null,
  registry: Registry = REGISTRY,
): Coverage {
  const national = registry.national.map((entry) => ({ ...entry, level: 'national' as const }))
  const region = jurisdiction ? registry.regions[jurisdiction.region] : undefined
  const comune = jurisdiction && region ? region.comuni[jurisdiction.comune] : undefined

  return {
    entries: [
      ...national,
      ...(region?.regional ?? []).map((entry) => ({ ...entry, level: 'region' as const })),
      ...(comune?.municipal ?? []).map((entry) => ({ ...entry, level: 'comune' as const })),
    ],
    regionKnown: Boolean(region),
    comuneKnown: Boolean(comune),
  }
}

/**
 * The adapter implementations the running process has, by id. Built at worker
 * boot from whatever is configured; an id the registry names but this map
 * lacks is reported (`resolveAdapters`), never guessed at.
 */
export type AdapterSet = ReadonlyMap<string, ComplianceAdapter>

export interface Resolved {
  entry: RegistryEntry
  adapter: ComplianceAdapter
}

/**
 * The registry entries of one obligation type, joined to their
 * implementations. Entries without one come back in `missing`, so the caller
 * can say so instead of generating an obligation nothing can discharge.
 */
export function resolveAdapters(
  coverage: Coverage,
  adapters: AdapterSet,
  type: ObligationType,
): { resolved: Resolved[]; missing: RegistryEntry[] } {
  const resolved: Resolved[] = []
  const missing: RegistryEntry[] = []

  for (const entry of coverage.entries) {
    if (entry.obligation !== type) continue
    const adapter = adapters.get(entry.adapter)
    if (adapter) resolved.push({ entry, adapter })
    else missing.push(entry)
  }

  return { resolved, missing }
}
