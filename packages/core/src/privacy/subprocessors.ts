/**
 * The sub-processor register (E8.3, D9, D18).
 *
 * ## Why this is config and not a document
 *
 * E8.3 asks for a register generated from config "so that contracts and reality
 * never diverge". The divergence it is aiming at is specific and it has a
 * direction: a provider gets wired in during a sprint, the register is a
 * markdown file somebody updates later, and later does not come. Every
 * sub-processor disclosure that has ever been wrong was wrong in exactly that
 * way.
 *
 * So the register is this array. `docs/legal/sub-processor-register.md` is
 * rendered from it and CI fails when the committed file and the rendered one
 * differ, which makes the document a build output rather than a promise.
 *
 * The second half is `registerProvider` in `src/llm`, which refuses any LLM
 * provider whose `subProcessorRegisterEntry` is not an id found here. A
 * provider cannot be in the code and absent from the register, because the code
 * asks the register.
 *
 * ## Status is the honest part
 *
 * Four of the entries below are `undecided`: no contract, no data flowing, an
 * open external decision in 04 §0. They are in the register anyway, marked, so
 * that the register describes the system as it is rather than as the four
 * decisions would leave it. A register listing only what is live reads as
 * complete and is not.
 */

export type SubProcessorStatus =
  /** Contracted, live, personal data flowing today. */
  | 'in-use'
  /** Contracted and configured, not yet carrying production data. */
  | 'staging'
  /** Chosen in an ADR, not yet contracted or configured; no data flowing. */
  | 'planned'
  /** Named in an ADR, no provider chosen, no data anywhere. */
  | 'undecided'

export interface SubProcessor {
  /** `SP-00n`. Referenced from code — `LlmProvider.subProcessorRegisterEntry`. */
  id: string
  name: string
  /** What they do for us, in the words a DPA annex uses. */
  purpose: string
  /** Categories of personal data reaching them. Empty for `undecided`. */
  dataCategories: string[]
  /** Where the processing happens. `—` while undecided. */
  region: string
  /** The legal entity's home, which is not the same question as the region. */
  established: string
  status: SubProcessorStatus
  /** The contract that covers it, or what is blocking one. */
  contract: string
  /** ISO date a human last checked the residency claim. Null while undecided. */
  verifiedAt: string | null
  /** Anything a reader would otherwise ask. */
  note?: string
}

export const SUBPROCESSORS: SubProcessor[] = [
  {
    id: 'SP-001',
    name: 'Supabase',
    purpose: 'Managed Postgres, authentication and object storage — the primary data store.',
    dataCategories: [
      'guest identity and contact details',
      'reservation and stay records',
      'identity documents (transient, see the retention map)',
      'guest messages',
      'staff account records',
    ],
    region: 'EU (Frankfurt, eu-central-1)',
    established: 'United States',
    status: 'in-use',
    contract: 'Supabase DPA with SCCs; EU region pinned at project creation.',
    verifiedAt: '2026-08-29',
    note: 'ADR-006 records this as a tier-1 residency claim: an EU region operated by a US-owned provider. The exit path is plain Postgres — no proprietary features in the domain layer — and that is the mitigation, stated rather than implied.',
  },
  {
    id: 'SP-002',
    name: 'Vercel',
    purpose: 'Hosting and edge delivery for the guest-facing web application.',
    dataCategories: [
      'IP addresses and request metadata',
      'form contents in transit (bookings, pre-arrival)',
    ],
    region: 'EU (fra1)',
    established: 'United States',
    status: 'in-use',
    contract: 'Vercel DPA with SCCs; functions pinned to fra1.',
    verifiedAt: '2026-08-29',
    note: 'Renders and forwards; stores nothing. The pinning is a deployment setting, which means it is a thing that can be changed by accident — 04 §3 makes the region part of the deploy checklist for that reason.',
  },
  {
    id: 'SP-003',
    name: 'Fly.io / Hetzner (EU)',
    purpose: 'Hosting for the worker process — jobs, agents, scheduled work.',
    dataCategories: ['everything the database holds, in memory during job execution'],
    region: 'EU',
    established: 'United States (Fly.io) / Germany (Hetzner)',
    status: 'staging',
    contract:
      'Not yet contracted for production. The choice between them is a cost and operations decision, not a residency one — both are EU-region capable.',
    verifiedAt: '2026-08-29',
    note: 'ADR-003. The worker is a persistent Node process and never serverless, which narrows the hosting choice more than residency does.',
  },
  {
    id: 'SP-004',
    name: 'Email service provider — undecided',
    purpose:
      'Transactional email: booking confirmations, pre-arrival invitations, escalation alerts.',
    dataCategories: [],
    region: '—',
    established: '—',
    status: 'undecided',
    contract: 'Blocked: 04 §0 item — an ESP that passes D9 residency has not been chosen.',
    verifiedAt: null,
    note: 'The port exists and a mock sender is behind it. Nothing has ever been sent to a real address from this platform, and until an entry here says otherwise, nothing will be.',
  },
  {
    id: 'SP-005',
    name: 'SMS and WhatsApp Business Solution Provider — undecided',
    purpose: 'Transactional SMS and WhatsApp messages to guests.',
    dataCategories: [],
    region: '—',
    established: '—',
    status: 'undecided',
    contract: 'Blocked: 04 §0 — WhatsApp BSP verification is not complete and no BSP is selected.',
    verifiedAt: null,
    note: 'WhatsApp implies Meta as a further sub-processor whichever BSP is chosen. That has to be disclosed here as its own entry when the choice is made, not folded into the BSP’s line.',
  },
  {
    id: 'SP-006',
    name: 'OpenRouter',
    purpose:
      'Model gateway for the concierge orchestrator (intent routing, tool selection) and, from WP0.4, document OCR.',
    dataCategories: [
      'guest message text in transit',
      'booking facts passed as tool context',
      'identity-document images in transit (WP0.4, demo documents only until the transfer assessment covers it)',
    ],
    region:
      'Global routing; processing may be outside the EU (EU in-region routing available on Business/Enterprise)',
    established: 'United States',
    status: 'staging',
    contract:
      'OpenRouter terms and DPA with SCCs; requests set zero data retention and deny data collection. Permitted by ADR-029 as a recorded exception to EU-only processing; storage stays in the EU.',
    verifiedAt: '2026-09-27',
    note: 'Enforced in code: `registerProvider` refuses a non-EU provider unless it cites ADR-029 and this entry exists. Reassessed at production with paying properties; moving to EU routing is a base-URL change.',
  },
  {
    id: 'SP-007',
    name: 'Payment provider — undecided',
    purpose: 'Card authorisation, deposits, refunds and payment-method vaulting.',
    dataCategories: [],
    region: '—',
    established: '—',
    status: 'undecided',
    contract: 'Blocked: ADR-010 and 04 §0 item 6. No provider is connected.',
    verifiedAt: null,
    note: 'Card data would never reach our database in any case — the adapter deals in intents and references. The mock adapter marks every row `simulated` and the console says so on screen.',
  },
  {
    id: 'SP-008',
    name: 'Alloggiati channel — undecided',
    purpose:
      'Transmission of guest registration data to the Italian accommodated-persons registry.',
    dataCategories: [],
    region: '—',
    established: '—',
    status: 'undecided',
    contract:
      'Blocked: 04 §0 item 5 — direct web service versus an intermediary is an open legal question.',
    verifiedAt: null,
    note: 'An intermediary would be a sub-processor handling identity documents, which is the most sensitive flow in the product and the one where this register matters most. A direct integration with the Questura’s own service adds no sub-processor at all — the authority is a recipient, not a processor.',
  },
  {
    id: 'SP-009',
    name: 'Supabase — staff identity project',
    purpose:
      'Authentication of BookOne operators for the admin console (ADR-031): a separate project from the hotels’ one, so staff and hotel identities never share a store.',
    dataCategories: ['staff email addresses', 'staff MFA factors', 'staff sign-in metadata'],
    region: 'EU (Frankfurt)',
    established: 'United States (Supabase Inc.); EU region selected',
    status: 'planned',
    contract:
      'Same vendor and DPA as SP-001, separate project and scope. Locally the console shares the development project; production refuses to start if the two are the same.',
    verifiedAt: null,
    note: 'Holds BookOne staff data only — no guest or hotel-user data.',
  },
  {
    id: 'SP-010',
    name: 'Tailscale',
    purpose:
      'Zero-trust network access to internal surfaces: the admin console, the full api, host SSH (ADR-032 item 1).',
    dataCategories: ['staff device and account identifiers', 'connection metadata'],
    region:
      'Coordination plane outside the EU; traffic is end-to-end encrypted between our nodes and relays carry only ciphertext',
    established: 'Canada',
    status: 'planned',
    contract: 'Tailscale DPA with SCCs, to be signed before the Phase 0 host carries pilot data.',
    verifiedAt: null,
    note: 'No guest data passes through Tailscale in readable form; it sees who connected to which node, when.',
  },
  {
    id: 'SP-011',
    name: 'Hetzner Online',
    purpose: 'The Phase 0 VM running api, worker and admin containers (ADR-033).',
    dataCategories: [
      'guest and hotel data in memory during request and job processing (stored data stays in SP-001)',
    ],
    region: 'EU (Falkenstein / Nuremberg / Helsinki)',
    established: 'Germany',
    status: 'planned',
    contract:
      'Hetzner DPA (Art. 28). The OCI instance in an EU region is the named alternative; whichever is used gets this entry.',
    verifiedAt: null,
    note: 'Compute only. ADR-033: no pilot guest data on the host before working backups and a completed restore drill.',
  },
  {
    id: 'SP-012',
    name: 'Infisical',
    purpose: 'Secrets management for the Phase 0 host (ADR-032 item 3).',
    dataCategories: ['service credentials and API keys — no personal data'],
    region: 'EU cloud region, or self-hosted on SP-011',
    established: 'United States',
    status: 'planned',
    contract:
      'EU cloud with DPA, or self-hosted (no sub-processor at all). Decided when the host is provisioned.',
    verifiedAt: null,
  },
  {
    id: 'SP-013',
    name: 'Twilio (Twilio Ireland Ltd)',
    purpose:
      'WhatsApp and SMS: guest conversations on WhatsApp, owner alerts and handoffs to the owner’s phone (ADR-035).',
    dataCategories: [
      'guest and owner phone numbers',
      'message text in transit',
      'delivery status metadata',
    ],
    region:
      'Ireland (IE1) where the account supports it, otherwise the US; WhatsApp content also passes through Meta’s Cloud API, whose processing may be outside the EU',
    established: 'Ireland (contracting entity); United States (parent)',
    status: 'staging',
    contract:
      'Twilio DPA with SCCs and Binding Corporate Rules. Meta (WhatsApp Business Platform) is Twilio’s sub-processor for WhatsApp under Meta’s data processing terms. Permitted by ADR-035 as a recorded exception to EU-only processing; storage of conversations stays in the EU (SP-001).',
    verifiedAt: '2026-09-27',
    note: 'The adapter deletes each message resource from Twilio once it reaches a final state, so Twilio’s log holds content only in flight. Meta’s transient retention for delivery is outside our control. Re-evaluated against 360dialog (EU) and Cloud API directly (ADR-035).',
  },
  {
    id: 'SP-014',
    name: 'Grafana Labs (Grafana Cloud)',
    purpose:
      'Storage and query of telemetry — traces, metrics and logs — from every service (ADR-036).',
    dataCategories: [
      'service telemetry: platform ids (property, reservation, thread), durations, outcomes, model and token counts',
      'staff and guest personal data excluded by design: redacted at source and stripped again at the collector',
    ],
    region:
      'EU region of Grafana Cloud (to be selected at sign-up); alternatively self-hosted on SP-011',
    established: 'United States (Grafana Labs); EU region selected',
    status: 'planned',
    contract:
      'Grafana Labs DPA with SCCs; EU region only. Self-hosting the same stack (Tempo, Loki, Prometheus) on the Phase 0 host removes the entry.',
    verifiedAt: null,
    note: 'Phoenix, for model spans, is self-hosted on our own host and is not a sub-processor.',
  },
]

export const SUBPROCESSOR_IDS: ReadonlySet<string> = new Set(SUBPROCESSORS.map((sp) => sp.id))

/**
 * Whether an id names a real register entry.
 *
 * `registerProvider` calls this. Before it did, the check was that the field
 * was a non-empty string — which any typo satisfies, and a typo in a register
 * reference is indistinguishable from a provider nobody disclosed.
 */
export function isRegisteredSubProcessor(id: string): boolean {
  return SUBPROCESSOR_IDS.has(id.trim())
}

export function subProcessor(id: string): SubProcessor | undefined {
  return SUBPROCESSORS.find((sp) => sp.id === id.trim())
}

/**
 * Renders the register as the markdown committed to `docs/legal/`.
 *
 * Deterministic: no clock, no ordering surprises. A generated document with a
 * timestamp in it differs from itself on every run, and then the CI check that
 * exists to catch drift catches nothing but its own noise.
 */
export function renderRegister(): string {
  const lines: string[] = []

  lines.push('# Sub-processor register')
  lines.push('')
  lines.push(
    '**Generated from `packages/core/src/privacy/subprocessors.ts`. Do not edit by hand** —',
  )
  lines.push('CI compares this file against the rendered output and fails when they differ.')
  lines.push('')
  const undecided = SUBPROCESSORS.filter((sp) => sp.status === 'undecided').length
  const counted =
    ['None', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'][undecided] ??
    String(undecided)

  lines.push('D9, as amended by ADR-029: stored data stays in the EU, and no service, endpoint or')
  lines.push('region — in the EU or not — is used without an entry here first. Two recorded')
  lines.push('exceptions allow processing outside the EU: model calls (ADR-029) and WhatsApp/SMS')
  lines.push('messaging (ADR-035). Their entries say so.')
  lines.push(
    `${counted} ${undecided === 1 ? 'entry below is' : 'entries below are'} \`undecided\` on purpose — the external decisions in 04 §0,`,
  )
  lines.push('listed so this register describes the system as it is rather than as those decisions')
  lines.push('would leave it.')
  lines.push('')

  const groups: [SubProcessorStatus, string][] = [
    ['in-use', 'In use'],
    ['staging', 'Configured, not carrying production data'],
    ['planned', 'Chosen, not yet contracted — no data flowing'],
    ['undecided', 'Not chosen — no data flowing'],
  ]

  for (const [status, heading] of groups) {
    const entries = SUBPROCESSORS.filter((sp) => sp.status === status)
    if (entries.length === 0) continue

    lines.push(`## ${heading}`)
    lines.push('')

    for (const entry of entries) {
      lines.push(`### ${entry.id} — ${entry.name}`)
      lines.push('')
      lines.push(`**Purpose.** ${entry.purpose}`)
      lines.push('')
      lines.push(`**Processing region.** ${entry.region}`)
      lines.push('')
      lines.push(`**Entity established in.** ${entry.established}`)
      lines.push('')

      if (entry.dataCategories.length > 0) {
        lines.push('**Categories of personal data.**')
        lines.push('')
        for (const category of entry.dataCategories) lines.push(`- ${category}`)
        lines.push('')
      } else {
        lines.push('**Categories of personal data.** None — nothing is sent to this provider.')
        lines.push('')
      }

      lines.push(`**Contract.** ${entry.contract}`)
      lines.push('')
      lines.push(
        `**Residency last verified.** ${entry.verifiedAt ?? '— (nothing to verify; no provider chosen)'}`,
      )
      lines.push('')

      if (entry.note) {
        lines.push(entry.note)
        lines.push('')
      }
    }
  }

  return lines.join('\n')
}
