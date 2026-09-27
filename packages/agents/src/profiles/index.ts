import { PROFILE_PROMPTS } from '../prompts/profiles'
import { getTool } from '../tools'
import { ProfileSchema, type Profile } from './schema'
import bookingSupport from './booking-support.json'
import checkout from './checkout.json'
import complaints from './complaints.json'
import generalInfo from './general-info.json'
import ownerBackoffice from './owner-backoffice.json'
import payments from './payments.json'
import preArrival from './pre-arrival.json'
import preSale from './pre-sale.json'

export type { Profile } from './schema'

/**
 * Every profile, as data (ADR-021).
 *
 * Imported statically rather than read from disk: the worker is bundled, and a
 * directory scanned at runtime would be empty in the image. `profiles.test.ts`
 * asserts that every `*.json` in this directory is listed here, so a new file
 * cannot be silently left out.
 */
export const PROFILE_SOURCES: Record<string, unknown> = {
  'booking-support.json': bookingSupport,
  'checkout.json': checkout,
  'complaints.json': complaints,
  'general-info.json': generalInfo,
  'owner-backoffice.json': ownerBackoffice,
  'payments.json': payments,
  'pre-arrival.json': preArrival,
  'pre-sale.json': preSale,
}

export class ProfileError extends Error {
  constructor(file: string, problems: string[]) {
    super(`Profile ${file} is invalid:\n  - ${problems.join('\n  - ')}`)
    this.name = 'ProfileError'
  }
}

/**
 * Validate every profile and return them by id. Throws on the first bad file.
 *
 * Called at worker boot, so a malformed profile stops the process with the
 * file and the reason, rather than surfacing as a guest who never gets an
 * answer. Beyond the schema it checks what only the codebase can: every tool
 * exists, the prompt exists, the file name matches the id, and no two files
 * claim one id.
 */
export function loadProfiles(
  sources: Record<string, unknown> = PROFILE_SOURCES,
): Map<string, Profile> {
  const profiles = new Map<string, Profile>()

  for (const [file, raw] of Object.entries(sources)) {
    const parsed = ProfileSchema.safeParse(raw)

    if (!parsed.success) {
      throw new ProfileError(
        file,
        parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
      )
    }

    const profile = parsed.data
    const problems: string[] = []

    if (file !== `${profile.id}.json`) problems.push(`file name does not match id "${profile.id}"`)
    if (profiles.has(profile.id)) problems.push(`id "${profile.id}" is used by another file`)
    if (!PROFILE_PROMPTS[profile.prompt]) problems.push(`prompt "${profile.prompt}" does not exist`)

    for (const name of profile.tools) {
      if (!getTool(name)) problems.push(`tool "${name}" does not exist`)
    }

    if (problems.length > 0) throw new ProfileError(file, problems)

    profiles.set(profile.id, profile)
  }

  return profiles
}

let cached: Map<string, Profile> | null = null

/** The validated profiles, loaded once per process. */
export function profiles(): Map<string, Profile> {
  cached ??= loadProfiles()
  return cached
}

export function getProfile(id: string): Profile {
  const profile = profiles().get(id)
  if (!profile) throw new Error(`Unknown profile "${id}"`)
  return profile
}

/** Every tool any profile can reach — the union AG-01's grant must cover. */
export function profileToolNames(): string[] {
  return [...new Set([...profiles().values()].flatMap((profile) => profile.tools))].sort()
}
