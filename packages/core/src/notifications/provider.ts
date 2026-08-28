import { ResidencyError, type ResidencyDeclaration } from '../llm/provider'

/**
 * The outbound-message port.
 *
 * Email is the only channel Sprint 3 ships (04 §1). SMS and WhatsApp are
 * additive and gated on BSP verification, which is a calendar item nobody can
 * compress — so the port takes a channel now rather than being renamed later,
 * and the two absent channels cost exactly one enum value each.
 *
 * The provider is not chosen here on purpose. Every candidate ESP is a
 * **sub-processor of guest personal data** — names, email addresses, and the
 * contents of a message about someone's travel. D9 makes that a residency
 * decision before it is an engineering one, and `registerNotificationProvider`
 * below is where that decision is enforced rather than assumed.
 */

export type NotificationChannel = 'email' | 'sms' | 'whatsapp'

export interface OutboundMessage {
  channel: NotificationChannel
  /** Email address or E.164 number, depending on the channel. */
  to: string
  /** Null for channels without one. */
  subject: string | null
  body: string
  locale: string
}

export interface SendResult {
  /** The provider's own id, kept so a delivery complaint can be traced. */
  providerMessageId?: string
}

export interface NotificationProvider {
  readonly name: string
  readonly channels: readonly NotificationChannel[]
  /**
   * Same declaration the LLM providers make, and enforced by the same rules.
   * An ESP handles more identifiable personal data than a model call does; it
   * would be strange to hold it to a lower standard.
   */
  readonly residency: ResidencyDeclaration
  send(message: OutboundMessage): Promise<SendResult>
}

/**
 * Raised when a provider cannot send on the channel it was handed.
 * Retryable is false — a different channel will not appear on retry.
 */
export class UnsupportedChannelError extends Error {
  constructor(provider: string, channel: NotificationChannel) {
    super(`provider "${provider}" does not send on ${channel}`)
    this.name = 'UnsupportedChannelError'
  }
}

const providers = new Map<string, NotificationProvider>()

/** How stale a residency verification may be. Same year as ADR-012's. */
const MAX_VERIFICATION_AGE_DAYS = 365

/**
 * The gate. Identical in spirit to `registerProvider` in `../llm/registry` —
 * duplicated rather than abstracted because the two are enforcing the same
 * policy on different things, and a shared helper would make it easy to relax
 * both at once by editing one line.
 */
export function registerNotificationProvider(
  provider: NotificationProvider,
  now: Date = new Date(),
): void {
  const { residency, name } = provider

  if (provider.channels.length === 0) {
    throw new Error(`notification provider "${name}" declares no channels`)
  }

  if (!residency.euProcessing) {
    throw new ResidencyError(name, 'EU processing is not declared')
  }

  if (!residency.region.trim()) {
    throw new ResidencyError(name, 'no processing region declared')
  }

  if (!residency.subProcessorRegisterEntry.trim()) {
    throw new ResidencyError(name, 'no sub-processor register entry')
  }

  const verifiedAt = new Date(residency.verifiedAt)
  if (Number.isNaN(verifiedAt.getTime())) {
    throw new ResidencyError(name, `unparseable verifiedAt "${residency.verifiedAt}"`)
  }

  if (verifiedAt.getTime() > now.getTime()) {
    throw new ResidencyError(name, 'verifiedAt is in the future')
  }

  const ageDays = (now.getTime() - verifiedAt.getTime()) / 86_400_000
  if (ageDays > MAX_VERIFICATION_AGE_DAYS) {
    throw new ResidencyError(
      name,
      `residency last verified ${Math.floor(ageDays)} days ago; re-verify and update the register`,
    )
  }

  providers.set(name, provider)
}

export function getNotificationProvider(name: string): NotificationProvider {
  const provider = providers.get(name)

  if (!provider) {
    throw new ResidencyError(
      name,
      'not registered. A provider must pass residency verification before use',
    )
  }

  return provider
}

export function listNotificationProviders(): NotificationProvider[] {
  return [...providers.values()]
}

/** Test seam. Not exported from the package barrel. */
export function clearNotificationProviders(): void {
  providers.clear()
}
