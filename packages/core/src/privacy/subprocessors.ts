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
    name: 'LLM provider — undecided',
    purpose: 'Language model inference for the concierge and the extraction agents.',
    dataCategories: [],
    region: '—',
    established: '—',
    status: 'undecided',
    contract:
      'Blocked: D18 and ADR-012 require verified EU processing and an entry here before a key is set.',
    verifiedAt: null,
    note: 'Enforced in code: `registerProvider` refuses any provider whose register entry id is not found in this file. AG-01 currently runs as a deterministic router with no model behind it at all.',
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
  lines.push('D9 makes EU residency non-negotiable: no service, endpoint or region outside the EU')
  lines.push('without an entry here first. Four entries below are `undecided` on purpose — they')
  lines.push('are the external decisions in 04 §0, listed so this register describes the system')
  lines.push('as it is rather than as those decisions would leave it.')
  lines.push('')

  const groups: [SubProcessorStatus, string][] = [
    ['in-use', 'In use'],
    ['staging', 'Configured, not carrying production data'],
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
