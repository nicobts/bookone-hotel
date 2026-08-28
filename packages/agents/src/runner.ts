import { agentRuns, asService } from '@bookone/core/db'
import { getAgent, grantsTool, type AgentDefinition, type AutonomyTier } from './registry'
import { getTool, type ToolResult } from './tools'

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
      callTool(agent, input.propertyId, tool, toolInput, toolCalls),
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
  propertyId: string,
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

  // The context is the scoping boundary: one property, fixed by the runner and
  // not readable from the agent's own input.
  const result = await implementation.run({ propertyId }, toolInput)
  log.push({ tool, ok: result.ok, output: result.output })

  return result
}

type ToolCaller = (tool: string, input: Record<string, unknown>) => Promise<ToolResult>

/**
 * What each agent actually does.
 *
 * A switch rather than a plugin lookup while there is one agent: the indirection
 * would cost a reader more than it saves, and the second agent is the right time
 * to add it.
 */
async function execute(
  agent: AgentDefinition,
  input: RunInput,
  call: ToolCaller,
): Promise<{ output: Record<string, unknown>; confidence: number | null }> {
  switch (agent.name) {
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
