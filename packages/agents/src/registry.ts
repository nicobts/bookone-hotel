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
 * The tier is about capability, not about caution: anything touching money or
 * dates is T2, and the tools for it deliberately do not exist yet (Sprint 8
 * builds the proposal surface those need). A complaint with legal wording is T3
 * and reaches a person with nothing drafted.
 *
 * ## Why `model: 'none'`, on the agent that most obviously wants a model
 *
 * Because today it would have nothing to do. Matching a question to a stored
 * answer is retrieval, and relaying a stored sentence is not generation —
 * exactly the reasoning AG-05 records for arithmetic. `LLM_API_KEY` is empty and
 * no provider is registered, so this is also the honest description of what
 * runs.
 *
 * When a provider is connected, the model widens **recall** — which phrasings
 * reach the right article — and the tier and the tool grants below do not move.
 * The day it is asked to write a sentence instead of choosing one is the day
 * this comment and ADR-009 both have to change, which is the point of writing
 * it down here.
 */
export const AG_01: AgentDefinition = {
  name: 'AG-01',
  description: 'Guest Concierge — answers in-stay questions from the property knowledge base',
  tier: 'T1',
  /*
   * Five tools, and the absences matter more than the presences. Nothing here
   * changes a booking, quotes a price, moves a date or touches money (06 §2:
   * those are T2), and nothing fiscal exists to grant (D11, ADR-011).
   */
  tools: ['search_kb', 'get_reservation', 'get_property_info', 'create_task', 'escalate'],
  model: 'none',
  /*
   * Zero because nothing costs anything yet. It becomes a real ceiling the day
   * a provider is registered, and it is here now so that connecting one is a
   * config change rather than a new concept — a runaway conversational agent is
   * the most expensive kind (06 §4).
   */
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
  /*
   * Two tools, and the missing third is the point: there is no
   * `reclassify_fee`, no `raise_fee`, nothing that can increase a charge. The
   * absence is the control (ADR-011).
   */
  tools: ['audit_attribution', 'credit_unevidenced_fee'],
  model: 'none',
  dailyBudgetCents: 0,
}

const registry = new Map<string, AgentDefinition>([
  [AG_01.name, AG_01],
  [AG_05.name, AG_05],
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
