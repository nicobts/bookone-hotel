import type { Feature } from '@bookone/core/onboarding'
import { READ_ONLY_TOOLS } from './tools/read-only'
import bookingSupport from './profiles/booking-support.json'
import checkout from './profiles/checkout.json'
import complaints from './profiles/complaints.json'
import generalInfo from './profiles/general-info.json'
import ownerBackoffice from './profiles/owner-backoffice.json'
import payments from './profiles/payments.json'
import preArrival from './profiles/pre-arrival.json'
import preSale from './profiles/pre-sale.json'

/**
 * What the agents are and may do, as data, for the console's agents page
 * (ADR-038).
 *
 * Pure: it reads the profile JSON and the read-only allowlist, and nothing that
 * executes, so `apps/web` can import it without the tool implementations. The
 * registry facts restated below (tier, feature, tools) are checked against the
 * registry by `catalog.test.ts`; a catalogue that drifted would tell an owner
 * something untrue about what their concierge does.
 *
 * No prose lives here. Names, purposes and tool labels are in the four message
 * catalogues under `console.agents`, keyed by these ids.
 */

/** How a tool touches the world, as an owner needs to know it. */
export type ToolClass = 'read' | 'action' | 'approval'

export interface CatalogTool {
  name: string
  class: ToolClass
}

export interface CatalogProfile {
  id: string
  modelTier: 'small' | 'strong'
  primaryAction: string | null
  tools: CatalogTool[]
}

export type AgentAudience = 'guests' | 'owner' | 'system'

export interface CatalogAgent {
  id: 'AG-01' | 'AG-03' | 'AG-05' | 'AG-06' | 'AG-07'
  /** `conversation` agents can be tried from the console; `background` ones run on their own. */
  kind: 'conversation' | 'background'
  audience: AgentAudience
  /** The entitlement it needs; `core` when every property has it. */
  feature: Feature | 'core'
  tier: 'T1' | 'T2'
  profiles: CatalogProfile[]
  /** Tools of an agent without profiles. */
  tools: CatalogTool[]
}

export const HARD_RULES = ['emergency', 'money', 'identity', 'unknown_twice'] as const
export type CatalogHardRule = (typeof HARD_RULES)[number]

interface ProfileJson {
  id: string
  modelTier: string
  primaryAction?: string
  tools: string[]
  approvalRequired: string[]
}

export function classify(tool: string, approvalRequired: readonly string[] = []): ToolClass {
  if (approvalRequired.includes(tool)) return 'approval'
  return READ_ONLY_TOOLS.has(tool) ? 'read' : 'action'
}

function profile(json: ProfileJson): CatalogProfile {
  return {
    id: json.id,
    modelTier: json.modelTier === 'small' ? 'small' : 'strong',
    primaryAction: json.primaryAction ?? null,
    tools: json.tools.map((name) => ({ name, class: classify(name, json.approvalRequired) })),
  }
}

/** The concierge's profiles, in the order a guest's journey meets them. */
const GUEST_PROFILES: ProfileJson[] = [
  preSale,
  generalInfo,
  preArrival,
  bookingSupport,
  payments,
  checkout,
  complaints,
]

const tools = (names: string[]): CatalogTool[] =>
  names.map((name) => ({ name, class: classify(name) }))

export const AGENT_CATALOG: CatalogAgent[] = [
  {
    id: 'AG-01',
    kind: 'conversation',
    audience: 'guests',
    feature: 'concierge',
    tier: 'T1',
    profiles: GUEST_PROFILES.map(profile),
    // Beside the profiles: every turn can hand over or file a request.
    tools: tools(['escalate', 'create_task']),
  },
  {
    id: 'AG-06',
    kind: 'conversation',
    audience: 'owner',
    feature: 'concierge',
    tier: 'T1',
    profiles: [profile(ownerBackoffice)],
    tools: [],
  },
  {
    id: 'AG-05',
    kind: 'background',
    audience: 'system',
    feature: 'pms_sync',
    tier: 'T1',
    profiles: [],
    tools: tools(['classify_discrepancy']),
  },
  {
    id: 'AG-07',
    kind: 'background',
    audience: 'system',
    feature: 'core',
    tier: 'T1',
    profiles: [],
    tools: tools(['audit_attribution', 'credit_unevidenced_fee']),
  },
  {
    id: 'AG-03',
    kind: 'background',
    audience: 'system',
    feature: 'core',
    tier: 'T2',
    profiles: [],
    tools: tools(['draft_knowledge']),
  },
]

/** Every tool name the catalogue mentions, for the label check. */
export function catalogToolNames(): string[] {
  return [
    ...new Set(
      AGENT_CATALOG.flatMap((agent) => [
        ...agent.tools.map((t) => t.name),
        ...agent.profiles.flatMap((p) => p.tools.map((t) => t.name)),
      ]),
    ),
  ].sort()
}
