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

const registry = new Map<string, AgentDefinition>([[AG_05.name, AG_05]])

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
