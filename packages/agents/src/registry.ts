/**
 * The agent roster (06-AI-AGENT-LAYER §2, ADR-011).
 *
 * Every agent declares its autonomy tier, its model config and — the part that
 * is load-bearing — its tool grants. The runner refuses any tool an entry does
 * not grant, so this file is the whole of what an agent is permitted to do.
 *
 * Autonomy is earned per agent per property. Everything ships at the most
 * conservative viable tier and widens only on evidence: ≥200 consecutive
 * accepted-without-edit runs on a capability, plus owner opt-in. Demotion is
 * immediate on any material error.
 */

import type { Gate } from '@bookone/core/onboarding'
import { profileToolNames } from './profiles'

/** T1 acts and is logged. T2 proposes and a human taps. T3 may only summarise. */
export type AutonomyTier = 'T1' | 'T2' | 'T3'

export interface AgentDefinition {
  /** Registry key and the `agent:{name}` actor suffix in `domain_events`. */
  name: string
  description: string
  /** The highest tier this agent may reach. A run may apply a lower one. */
  tier: AutonomyTier
  /**
   * Tools this agent may call. The runner rejects everything else — which is
   * what makes "no unauthorized capability" a property of the system rather
   * than of a prompt.
   */
  tools: string[]
  /**
   * Which model tier this agent needs, or `none`.
   *
   * `none` is a real answer and AG-05's classification is the case for it:
   * deciding whether two amounts differ by less than a euro is arithmetic. A
   * model would be slower, cost money, and occasionally be wrong about
   * subtraction — and ADR-009's discipline says facts come from tools, not from
   * generation. When AG-05 gains the T2 capability of *drafting* an
   * explanation, that capability gets a model and this becomes a per-capability
   * decision.
   */
  model: 'none' | 'extraction' | 'classification' | 'conversation' | 'drafting'
  /** Cap per property per day. A runaway agent is a cost incident (06 §4). */
  dailyBudgetCents: number
  /**
   * The feature a property needs for this agent to run for it (ADR-019), or
   * `core`. The runner refuses — and records — a run for a property without it.
   */
  feature: Gate
}

/**
 * AG-05 — Reconciliation Analyst (06 §2, Sprint 2).
 *
 * The first agent, chosen because it proves the whole loop end-to-end —
 * trigger, runner, typed tool, `agent_runs` record — against something with a
 * verifiable right answer. An agent whose output cannot be checked is a poor
 * first agent, whatever else it does.
 *
 * T1 covers classification only. Changing a discrepancy's status is T2, and
 * blocking-class discrepancies always page a human whatever the tier.
 */
export const AG_05: AgentDefinition = {
  name: 'AG-05',
  description: 'Reconciliation Analyst — classifies nightly discrepancies',
  tier: 'T1',
  feature: 'pms_sync',
  tools: ['classify_discrepancy'],
  model: 'none',
  dailyBudgetCents: 0,
}

/**
 * AG-01 — Guest Concierge (06 §2, Sprint 7).
 *
 * The in-stay messaging brain (E3.2), sharing its tool surface with the voice
 * workstream (Concierge PRD §9).
 *
 * ## Why T1, when it talks to guests
 *
 * Because of what it is permitted to say. Every tool returns a `phrase` — the
 * exact sentence the guest reads — and the agent relays one or escalates. It
 * cannot compose a claim, so the failure it can produce is *the wrong stored
 * answer*, not an invented one. That is a mistake a property can see, correct
 * in one edit, and recover from.
 *
 * The tier is about capability, not about caution. The hard rules route money,
 * identity and emergencies to a person before any profile runs, and the
 * money-shaped tools are held for approval rather than executed (ADR-021).
 *
 * ## The model routes; it does not write (ADR-022, ADR-023)
 *
 * When a provider is registered (OpenRouter, ADR-029), the model classifies
 * the turn and picks one tool from the profile's allow-list with its
 * arguments. That widens **recall** — which phrasings reach the right tool —
 * and changes neither the tier nor what the guest can be told, which is still
 * a tool's phrase. Without a provider the same orchestrator routes by rules,
 * which is the behaviour this agent had before profiles existed. The day a
 * model is asked to write a sentence instead of choosing one is the day ADR-022
 * has to be superseded.
 */
export const AG_01: AgentDefinition = {
  name: 'AG-01',
  description:
    'Guest Concierge — the Guest Desk orchestrator: hard rules, routing, one profile per turn',
  tier: 'T1',
  feature: 'concierge',
  /*
   * The router's own two tools, plus every tool any guest-facing or owner
   * profile lists (ADR-021). The grant is the outer fence; each profile's
   * allow-list is the inner one, checked per turn by the orchestrator.
   *
   * The absences still matter more than the presences. The money-shaped tools
   * here (`cancel_booking`, `create_payment_link`, `request_late_checkout`) are
   * in their profiles' `approvalRequired`, so the orchestrator records them
   * and hands them to a person instead of running them; and nothing fiscal
   * exists to grant (D11, ADR-011).
   */
  tools: ['create_task', 'escalate', ...profileToolNames()],
  /*
   * Classification: the model routes and picks tools, and never writes to a
   * guest (ADR-022). What actually ran is recorded per run — `none` when the
   * turn was routed by rules alone.
   */
  model: 'classification',
  /*
   * Zero because nothing costs anything yet. It becomes a real ceiling the day
   * a provider is registered, and it is here now so that connecting one is a
   * config change rather than a new concept — a runaway conversational agent is
   * the most expensive kind (06 §4).
   */
  dailyBudgetCents: 0,
}

/**
 * AG-06 — the owner's assistant (06 §2 "Support Agent", Guest Desk WP0.5).
 *
 * Runs the `owner-backoffice` profile for a verified owner number only
 * (`respondToOwner`). Its grant is the profile's four read-only lists: nothing
 * it can call changes a row, which is why T1 is safe — the worst it can do is
 * read an owner the wrong list.
 */
export const AG_06: AgentDefinition = {
  name: 'AG-06',
  description:
    "Owner's assistant — read-only answers about the property, for verified owner numbers",
  tier: 'T1',
  feature: 'concierge',
  tools: ['list_arrivals', 'list_capture_status', 'list_open_complaints', 'list_pending_approvals'],
  model: 'classification',
  dailyBudgetCents: 0,
}

/**
 * AG-07 — Attribution Auditor (06 §2, Sprint 8).
 *
 * Re-runs D14's attribution rule against every fee we billed at the AI rate and
 * asks whether the evidence still supports it. Nightly, per property.
 *
 * ## Why a T1 agent is allowed to move money
 *
 * Because of which way it can move it. The only action AG-07 has is crediting a
 * fee back — it cannot raise one, cannot reclassify a booking upward, and has
 * no tool that would let it. An agent whose entire capability is *reducing its
 * operator's revenue* has a failure mode of a bad quarter rather than a
 * defrauded customer, and that asymmetry is what makes acting alone safe here.
 *
 * It is also what D14 already commits us to. Disputes resolve in the owner's
 * favour, so a fee whose evidence does not hold is a fee we drop; the only
 * question was whether the owner had to notice first. The alternative — a queue
 * of fees *we* believe are wrong, worked through at our convenience while the
 * property is invoiced for them — is worse in a way that is hard to defend out
 * loud.
 *
 * `model: 'none'` for the same reason as AG-05: re-running a documented rule
 * over timestamps is arithmetic. If it ever drafts the explanation an owner
 * reads, that capability gets a model and this becomes a per-capability
 * decision.
 */
export const AG_07: AgentDefinition = {
  name: 'AG-07',
  description: 'Attribution Auditor — re-checks AI-attributed fees against their evidence',
  tier: 'T1',
  feature: 'core',
  /*
   * Two tools, and the missing third is the point: there is no
   * `reclassify_fee`, no `raise_fee`, nothing that can increase a charge. The
   * absence is the control (ADR-011).
   */
  tools: ['audit_attribution', 'credit_unevidenced_fee'],
  model: 'none',
  dailyBudgetCents: 0,
}

/**
 * AG-03 — Property Onboarding (06 §2, Sprint 9).
 *
 * Reads a property's own website and drafts knowledge-base articles from it.
 *
 * ## Always T2, and here that is structural rather than procedural
 *
 * 06 §2 says the owner reviews a diff-style proposal and accepts per section.
 * What ships is stronger than a review step: every article it writes is
 * `published: false`, and `searchKb` refuses to quote an unpublished article.
 * The agent cannot put a sentence in front of a guest even if the review never
 * happens. The review surface is the knowledge editor the owner is already in.
 *
 * ## What it actually does, versus what 06 §2 describes
 *
 * The roster entry describes ingesting a site, PDFs and menus and drafting the
 * whole configuration. No model is connected, so this is a heuristic: headings
 * that name a subject a guest asks about, and the prose beneath them. It is
 * worth having anyway — the bottleneck in the concierge is an empty knowledge
 * base, and six plausible drafts an owner edits in ten minutes moves that
 * further than a better matcher over nothing.
 *
 * When a provider is registered, what changes is the *extraction*. Drafting,
 * review and publishing are already the right shape around it.
 */
export const AG_03: AgentDefinition = {
  name: 'AG-03',
  description: 'Property Onboarding — drafts knowledge-base articles from the property website',
  tier: 'T2',
  feature: 'core',
  tools: ['draft_knowledge'],
  model: 'none',
  dailyBudgetCents: 0,
}

const registry = new Map<string, AgentDefinition>([
  [AG_01.name, AG_01],
  [AG_03.name, AG_03],
  [AG_05.name, AG_05],
  [AG_06.name, AG_06],
  [AG_07.name, AG_07],
])

export function getAgent(name: string): AgentDefinition {
  const agent = registry.get(name)

  if (!agent) {
    // Refused rather than defaulted. An unknown agent name means a trigger is
    // wired to something that does not exist, and running a default in its
    // place would hide that behind plausible output.
    throw new Error(`Unknown agent "${name}". Register it in packages/agents/src/registry.ts.`)
  }

  return agent
}

export function listAgents(): AgentDefinition[] {
  return [...registry.values()]
}

/** Whether this agent is permitted to call this tool. */
export function grantsTool(agent: AgentDefinition, tool: string): boolean {
  return agent.tools.includes(tool)
}
