import {
  UnsupportedChannelError,
  type NotificationChannel,
  type NotificationProvider,
  type OutboundMessage,
  type SendResult,
} from '@bookone/core/notifications'
import { type TwilioClient, type TwilioRegion } from './client'
import { address } from './inbound'

export interface TwilioProviderOptions {
  client: TwilioClient
  region: TwilioRegion
  /** E.164 senders. A channel without one is not offered. */
  whatsappFrom?: string
  smsFrom?: string
  /** Public base URL of `apps/api`, for delivery status callbacks. */
  webhookBaseUrl?: string
}

/**
 * WhatsApp and SMS through Twilio (ADR-035), behind the same port the email
 * provider uses. Nothing outside this folder knows the provider's name.
 *
 * Residency: Twilio may process outside the EU, and WhatsApp content always
 * passes through Meta. That is declared, not hidden — `euProcessing: false`
 * with the ADR-035 exception and register entry SP-013 — and the registry
 * refuses it without both.
 */
export class TwilioNotificationProvider implements NotificationProvider {
  readonly name = 'twilio'
  readonly channels: readonly NotificationChannel[]
  readonly residency

  constructor(private readonly options: TwilioProviderOptions) {
    const channels: NotificationChannel[] = []
    if (options.whatsappFrom) channels.push('whatsapp')
    if (options.smsFrom) channels.push('sms')
    this.channels = channels

    this.residency = {
      euProcessing: false,
      transferException: 'ADR-035' as const,
      region:
        options.region === 'ie1'
          ? 'Twilio IE1 (Ireland); WhatsApp via Meta Cloud API'
          : 'Twilio US1; WhatsApp via Meta Cloud API',
      subProcessorRegisterEntry: 'SP-013',
      verifiedAt: '2026-09-27',
    }
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    const channel = message.channel
    if (channel !== 'whatsapp' && channel !== 'sms') {
      throw new UnsupportedChannelError(this.name, channel)
    }
    const from = channel === 'whatsapp' ? this.options.whatsappFrom : this.options.smsFrom
    if (!from) throw new UnsupportedChannelError(this.name, channel)

    const template = channel === 'whatsapp' ? message.template : undefined
    const { sid } = await this.options.client.sendMessage({
      from: address(channel, from),
      to: address(channel, message.to),
      ...(template
        ? { contentSid: template.id, contentVariables: template.variables }
        : { body: message.body }),
      ...(this.options.webhookBaseUrl
        ? {
            statusCallback: `${this.options.webhookBaseUrl.replace(/\/$/, '')}/webhooks/twilio/status`,
          }
        : {}),
    })

    return { providerMessageId: sid }
  }
}
