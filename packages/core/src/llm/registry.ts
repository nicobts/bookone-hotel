import { isRegisteredSubProcessor } from '../privacy/subprocessors'
import { ResidencyError, type LlmProvider } from './provider'

/**
 * The gate every provider passes through.
 *
 * Registration is the point at which D9 is enforced. A provider that cannot
 * declare EU processing, or whose declaration is incomplete, is refused here —
 * before any agent can reach it, and regardless of whether a key happens to be
 * set in the environment.
 *
 * The alternative was a note in a runbook saying "check residency before adding
 * a provider". Notes do not run.
 */
const providers = new Map<string, LlmProvider>()

/** How stale a residency verification may be before it must be re-checked. */
const MAX_VERIFICATION_AGE_DAYS = 365

export function registerProvider(provider: LlmProvider, now: Date = new Date()): void {
  const { residency, name } = provider

  if (!residency.euProcessing) {
    throw new ResidencyError(name, 'EU processing is not declared')
  }

  if (!residency.region.trim()) {
    throw new ResidencyError(name, 'no processing region declared')
  }

  // An entry in the register is what makes the claim auditable. Without it the
  // boolean above is just a field somebody set to true.
  if (!residency.subProcessorRegisterEntry.trim()) {
    throw new ResidencyError(name, 'no sub-processor register entry')
  }

  /*
   * And the entry has to exist (E8.3).
   *
   * Checking the field is non-empty accepts any typo, and a typo in a register
   * reference is indistinguishable from a provider nobody disclosed — the field
   * is set, the check passes, and the register does not mention them. Asking
   * the register closes that: a provider cannot be in the code and absent from
   * the document, because the code reads the document's source.
   */
  if (!isRegisteredSubProcessor(residency.subProcessorRegisterEntry)) {
    throw new ResidencyError(
      name,
      `sub-processor register has no entry "${residency.subProcessorRegisterEntry}"; add one before registering the provider (D9)`,
    )
  }

  const verifiedAt = new Date(residency.verifiedAt)
  if (Number.isNaN(verifiedAt.getTime())) {
    throw new ResidencyError(name, `unparseable verifiedAt "${residency.verifiedAt}"`)
  }

  const ageDays = (now.getTime() - verifiedAt.getTime()) / 86_400_000
  if (ageDays > MAX_VERIFICATION_AGE_DAYS) {
    throw new ResidencyError(
      name,
      `residency last verified ${Math.floor(ageDays)} days ago; re-verify and update the register`,
    )
  }

  if (verifiedAt.getTime() > now.getTime()) {
    throw new ResidencyError(name, 'verifiedAt is in the future')
  }

  providers.set(name, provider)
}

export function getProvider(name: string): LlmProvider {
  const provider = providers.get(name)

  if (!provider) {
    throw new ResidencyError(
      name,
      'not registered. A provider must pass residency verification before use',
    )
  }

  return provider
}

export function listProviders(): LlmProvider[] {
  return [...providers.values()]
}

/** Test seam. Not exported from the package barrel. */
export function clearProviders(): void {
  providers.clear()
}
