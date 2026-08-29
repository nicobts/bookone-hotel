import { classifyDivergences } from '@bookone/core/sync'
import type { PmsReservation } from '@bookone/core/adapters'
import { billingTools } from './billing'
import { conciergeTools } from './concierge'
import { draftKnowledgeTool } from './onboarding'

/**
 * Typed domain tools — the complete surface through which agents act.
 *
 * A tool is a domain command, identical to the one a human path calls, so an
 * agent's effect is indistinguishable from a person's and its *authorship* is
 * fully distinguishable in audit (ADR-011). If an agent needs a capability, the
 * tool gets built; there is no fallback to direct database access, and
 * fiscal-adjacent tools do not exist at all — enforced by absence, not policy.
 *
 * Guest-facing tools return pre-formed `phrase` fields so no model ever
 * composes a price, a date or an availability claim (ADR-009). AG-01's tools in
 * `./concierge` are the first that are guest-facing, and every one of them
 * returns the exact sentence the guest will read rather than the facts to build
 * one from. The tool-boundary audit checks that after the fact.
 */

export interface ToolContext {
  /** The runner scopes every call to one property. Cross-tenant is inexpressible. */
  propertyId: string
  /**
   * The one stay this run is about, when it is about one (AG-01).
   *
   * Set by the runner from its input, never read from anything the agent
   * produced — so "tell me about booking X" cannot reach a booking that is not
   * the guest's own. Absent for agents that operate on a property rather than
   * on a stay, which is why it is optional rather than empty-string.
   */
  reservationId?: string
  /** The conversation, when there is one, so a task can be traced to what asked for it. */
  threadId?: string
  /** The guest's language. A phrase exists in it or the tool reports a miss. */
  locale?: string
}

export interface ToolResult {
  ok: boolean
  output: Record<string, unknown>
}

export type Tool = {
  name: string
  description: string
  run: (context: ToolContext, input: Record<string, unknown>) => Promise<ToolResult>
}

/**
 * Classify one discrepancy.
 *
 * Wraps `classifyDivergences` from core rather than reimplementing it: the same
 * comparison decides what the nightly run records and what the agent says about
 * it, so the two can never disagree. An agent that classified by its own rules
 * would eventually contradict the row it was classifying.
 */
export const classifyDiscrepancyTool: Tool = {
  name: 'classify_discrepancy',
  description: 'Classify a reservation divergence as rounding, timezone or logic',

  run: async (_context, input) => {
    const ours = input.ours as
      | {
          arrivalDate: string
          departureDate: string
          totalCents: number | null
          roomTypeCode: string | null
        }
      | undefined
    const theirs = input.theirs as PmsReservation | undefined

    if (!ours || !theirs) {
      return { ok: false, output: { error: 'ours and theirs are required' } }
    }

    const divergences = classifyDivergences(ours, theirs)

    return {
      ok: true,
      output: {
        divergences,
        // The class the row should carry: worst wins, so one real disagreement
        // is never hidden behind a pile of one-cent differences.
        class: divergences.some((d) => d.class === 'logic')
          ? 'logic'
          : divergences.some((d) => d.class === 'tz')
            ? 'tz'
            : divergences.length > 0
              ? 'rounding'
              : 'none',
        // Confidence is 1 because this is arithmetic, not inference. Reporting
        // a hedged number for a deterministic comparison would make the tier
        // threshold meaningless for every agent that comes after.
        confidence: 1,
      },
    }
  },
}

export const tools: Record<string, Tool> = {
  [classifyDiscrepancyTool.name]: classifyDiscrepancyTool,
  ...Object.fromEntries(conciergeTools.map((tool) => [tool.name, tool])),
  ...Object.fromEntries(billingTools.map((tool) => [tool.name, tool])),
  [draftKnowledgeTool.name]: draftKnowledgeTool,
}

export function getTool(name: string): Tool | undefined {
  return tools[name]
}
