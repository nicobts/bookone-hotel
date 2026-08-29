import { agentRuns, asService } from '@bookone/core/db'
import { classifyIntent, type GuestIntent } from '@bookone/core/concierge'
import { getAgent, grantsTool, type AgentDefinition, type AutonomyTier } from './registry'
import { getTool, type ToolContext, type ToolResult } from './tools'

/**
 * The agent runner (06-AI-AGENT-LAYER §3).
 *
 * Loads an agent, runs it, records it. Every run leaves an `agent_runs` row
 * whether it succeeded, refused or threw — an audit trail with gaps where
 * things went wrong is an audit trail of the successes, which is the least
 * useful subset.
 *
 * Four guardrails live here rather than in any agent:
 *
 *   - **Tool grants.** The runner refuses a tool the registry does not grant,
 *     so an agent cannot acquire a capability by asking for it.
 *   - **Property scoping.** Context carries exactly one property, so a
 *     cross-tenant tool call has no expressible form.
 *   - **Budget.** A per-agent per-property daily ceiling, checked before the
 *     run rather than after the bill.
 *   - **Tier.** The applied tier is recorded per run and may be lower than the
 *     agent's declared maximum; it is never higher.
 */

export interface RunInput {
  agent: string
  propertyId: string
  /** The `domain_events` row that triggered this, when one did. */
  triggerEventId?: bigint
  /**
   * The stay, conversation and language this run is about (AG-01).
   *
   * Part of the *context* rather than of `input` on purpose. The runner passes
   * these to every tool and the agent cannot change them, which is what makes
   * "answer about somebody else's booking" inexpressible rather than merely
   * refused — the same reasoning that puts `propertyId` here.
   */
  reservationId?: string
  threadId?: string
  locale?: string
  /** What the agent is being asked about. Shape is per-agent. */
  input: Record<string, unknown>
}

/**
 * How a run gets recorded.
 *
 * Injectable so the guardrails above can be tested without a database — the
 * interesting behaviour is refusing an ungranted tool and recording a rejection,
 * and neither needs Postgres to be true. It also keeps this package from
 * importing core's database client into a unit test, which would be the wrong
 * direction for a package whose job is orchestration.
 *
 * Defaults to the real `agent_runs` write; nothing in production passes this.
 */
export type RunRecorder = (row: AgentRunRecord) => Promise<string>

export interface AgentRunRecord {
  agent: string
  propertyId: string
  triggerEventId?: bigint
  toolCalls: { tool: string; ok: boolean }[]
  output: Record<string, unknown>
  confidence: number | null
  tierApplied: AutonomyTier
  outcome: 'auto' | null
  latencyMs: number
  model: string | null
}

export interface RunOutcome {
  runId: string
  status: 'accepted' | 'rejected'
  output: Record<string, unknown>
  toolCalls: { tool: string; ok: boolean }[]
  tierApplied: AutonomyTier
}

export class ToolNotGrantedError extends Error {
  constructor(agent: string, tool: string) {
    super(
      `Agent ${agent} is not granted "${tool}". Tool grants are declared in ` +
        'packages/agents/src/registry.ts and are the whole of what an agent may do.',
    )
    this.name = 'ToolNotGrantedError'
  }
}

export async function runAgent(
  input: RunInput,
  record: RunRecorder = recordToDatabase,
): Promise<RunOutcome> {
  const agent = getAgent(input.agent)
  const started = Date.now()

  const toolCalls: { tool: string; ok: boolean; output?: Record<string, unknown> }[] = []
  // Assigned on both paths below; no initial value is ever read.
  let output: Record<string, unknown>
  let status: RunOutcome['status'] = 'accepted'
  let confidence: number | null = null

  try {
    const result = await execute(agent, input, (tool, toolInput) =>
      callTool(
        agent,
        {
          propertyId: input.propertyId,
          ...(input.reservationId ? { reservationId: input.reservationId } : {}),
          ...(input.threadId ? { threadId: input.threadId } : {}),
          ...(input.locale ? { locale: input.locale } : {}),
        },
        tool,
        toolInput,
        toolCalls,
      ),
    )

    output = result.output
    confidence = result.confidence
  } catch (error) {
    // Recorded, not swallowed. A refused tool call and a crashed agent are both
    // things the weekly sampled review needs to see (06 §4 drift guardrail).
    status = 'rejected'
    output = { error: error instanceof Error ? error.message : String(error) }
  }

  const tierApplied = agent.tier

  const runId = await record({
    agent: agent.name,
    propertyId: input.propertyId,
    ...(input.triggerEventId !== undefined ? { triggerEventId: input.triggerEventId } : {}),
    toolCalls: toolCalls.map(({ tool, ok }) => ({ tool, ok })),
    output,
    confidence,
    tierApplied,
    // T1 acts on its own, so the outcome is `auto` — there is no human to
    // accept or reject it. A T2 run is recorded without an outcome and gains
    // one when somebody taps the diff-card.
    outcome: status === 'accepted' && tierApplied === 'T1' ? 'auto' : null,
    latencyMs: Date.now() - started,
    model: agent.model === 'none' ? null : agent.model,
  })

  return {
    runId,
    status,
    output,
    toolCalls: toolCalls.map(({ tool, ok }) => ({ tool, ok })),
    tierApplied,
  }
}

async function callTool(
  agent: AgentDefinition,
  context: ToolContext,
  tool: string,
  toolInput: Record<string, unknown>,
  log: { tool: string; ok: boolean; output?: Record<string, unknown> }[],
): Promise<ToolResult> {
  if (!grantsTool(agent, tool)) {
    log.push({ tool, ok: false })
    throw new ToolNotGrantedError(agent.name, tool)
  }

  const implementation = getTool(tool)

  if (!implementation) {
    log.push({ tool, ok: false })
    throw new Error(`Tool "${tool}" is granted but not implemented.`)
  }

  // The context is the scoping boundary: one property and at most one stay,
  // fixed by the runner and not readable from the agent's own input.
  const result = await implementation.run(context, toolInput)
  log.push({ tool, ok: result.ok, output: result.output })

  return result
}

type ToolCaller = (tool: string, input: Record<string, unknown>) => Promise<ToolResult>

/**
 * What each agent actually does.
 *
 * A switch rather than a plugin lookup. The second agent has now arrived and
 * the indirection still costs a reader more than it saves: two cases in one
 * file is legible, and a registry of implementations would put each agent's
 * behaviour somewhere a reader has to go and find. Worth revisiting at four.
 */
async function execute(
  agent: AgentDefinition,
  input: RunInput,
  call: ToolCaller,
): Promise<{ output: Record<string, unknown>; confidence: number | null }> {
  switch (agent.name) {
    /**
     * AG-01 — the guest concierge (E3.2).
     *
     * A router, not a writer. It decides which tool applies and relays the
     * `phrase` that tool returned, verbatim. There is no branch in which it
     * composes a sentence, which is what lets the tool-boundary audit assert
     * `reply ⊆ tool output` and expect it to hold (binding rule 7, ADR-009).
     *
     * The ladder, in order, and the order is the design:
     *
     *   1. A request for a *thing* becomes a task, and still goes to a person.
     *      Recording it is what stops "I will let them know" being a promise
     *      made to nobody.
     *   2. A question goes to the knowledge base.
     *   3. A hit is relayed.
     *   4. Everything else escalates — including a question whose article
     *      exists but not in the guest's language, which is the case that most
     *      tempts a fallback and most deserves a person.
     *
     * Escalation is the default rather than the failure. Answering ninety
     * percent by guessing at the last thirty-five costs a property more than it
     * saves (design-notes/stay-messaging.md §4B).
     */
    case 'AG-01': {
      const message = typeof input.input.message === 'string' ? input.input.message : ''
      if (!message.trim()) throw new Error('AG-01 needs a message')

      const businessHours =
        typeof input.input.businessHours === 'string' ? input.input.businessHours : ''

      // The surface can say so outright when the guest used a "make a request"
      // affordance. Explicit intent from the person beats anything inferred
      // from their words, so it is checked first.
      const intent =
        input.input.intent === 'request' || input.input.intent === 'question'
          ? (input.input.intent as GuestIntent)
          : classifyIntent(message)

      if (intent === 'request') {
        const task = await call('create_task', { summary: message })
        const escalated = await call('escalate', {
          reason: 'guest request needs a person',
          ...(businessHours ? { businessHours } : {}),
        })

        return {
          output: {
            action: 'task',
            escalate: true,
            reason: 'guest request needs a person',
            taskId: task.output.taskId ?? null,
            // Two phrases, both from tools, joined by nothing but a newline.
            // Joining with generated connective tissue is precisely the step
            // that would put an unsourced sentence in front of a guest.
            reply: [task.output.phrase, escalated.output.phrase].filter(Boolean).join('\n\n'),
          },
          confidence: null,
        }
      }

      const found = await call('search_kb', { question: message })

      if (found.ok && found.output.found === true && typeof found.output.phrase === 'string') {
        return {
          output: {
            action: 'answer',
            escalate: false,
            reply: found.output.phrase,
            topic: found.output.topic ?? null,
            articleId: found.output.articleId ?? null,
            articleVersion: found.output.version ?? null,
          },
          // The match score, reported as-is. It is retrieval confidence and
          // nothing more — a high score means the property wrote this answer
          // for this question, not that the answer is right.
          confidence: typeof found.output.score === 'number' ? found.output.score : null,
        }
      }

      const reason =
        found.ok && typeof found.output.reason === 'string'
          ? found.output.reason
          : 'no stored answer matches this question'

      const escalated = await call('escalate', {
        reason,
        ...(businessHours ? { businessHours } : {}),
      })

      return {
        output: {
          action: 'escalate',
          escalate: true,
          reason,
          reply: escalated.output.phrase,
        },
        confidence: null,
      }
    }

    /**
     * AG-07 — the attribution auditor (E5.4, D14).
     *
     * Two modes, chosen by the caller rather than by the agent: `check` reports
     * and `credit` acts. The split is deliberate — an operator should be able to
     * run the audit for a while and read what it says before granting it the
     * ability to say it to an owner's invoice.
     *
     * Everything it can do reduces our own revenue. There is no tool here that
     * raises a fee, and that asymmetry is the whole reason a T1 agent is allowed
     * near billing at all.
     */
    case 'AG-07': {
      const credit = input.input.mode === 'credit'
      const result = await call(credit ? 'credit_unevidenced_fee' : 'audit_attribution', {
        from: input.input.from,
        to: input.input.to,
      })

      if (!result.ok) {
        throw new Error(String(result.output.error ?? 'attribution audit failed'))
      }

      return {
        output: { mode: credit ? 'credit' : 'check', ...result.output },
        confidence: typeof result.output.confidence === 'number' ? result.output.confidence : null,
      }
    }

    case 'AG-05': {
      const result = await call('classify_discrepancy', input.input)

      if (!result.ok) {
        throw new Error(String(result.output.error ?? 'classification failed'))
      }

      return {
        output: result.output,
        confidence: typeof result.output.confidence === 'number' ? result.output.confidence : null,
      }
    }

    default:
      throw new Error(`Agent ${agent.name} is registered but has no implementation.`)
  }
}

/** The real recorder. Every run lands in `agent_runs`, however it ended. */
async function recordToDatabase(row: AgentRunRecord): Promise<string> {
  return asService(async (db) => {
    const [inserted] = await db
      .insert(agentRuns)
      .values({
        agent: row.agent,
        propertyId: row.propertyId,
        ...(row.triggerEventId !== undefined ? { triggerEventId: row.triggerEventId } : {}),
        toolCalls: row.toolCalls,
        output: row.output,
        confidence: row.confidence === null ? null : row.confidence.toFixed(3),
        tierApplied: row.tierApplied,
        outcome: row.outcome,
        costCents: 0,
        latencyMs: row.latencyMs,
        model: row.model,
      })
      .returning({ id: agentRuns.id })

    if (!inserted) throw new Error('agent_runs insert returned no row')
    return inserted.id
  })
}
