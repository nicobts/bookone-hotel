import { createHash } from 'node:crypto'
import { agentRuns, asService } from '@bookone/core/db'
import { findCompletedToolCall, previewSimulatedPhrase } from '@bookone/core/concierge'
import type { RoutingTurn } from '@bookone/core/concierge'
import { listProviders, type LlmProvider } from '@bookone/core/llm'
import { createFeatureCheck, gateOpen, type FeatureCheck } from '@bookone/core/onboarding'
import { getAgent, grantsTool, type AgentDefinition, type AutonomyTier } from './registry'
import { getTool, READ_ONLY_TOOLS, type ToolContext, type ToolResult } from './tools'
import { orchestrate, type ExecuteTool, type NoteToolCall } from './orchestrator'
import { executeOwner } from './owner'

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
  /** The public base URL, for links in tool phrases. Context, like the stay. */
  appUrl?: string
  /** What the agent is being asked about. Shape is per-agent. */
  input: Record<string, unknown>
  /**
   * A preview turn (ADR-038): only `READ_ONLY_TOOLS` execute; every other tool
   * is simulated and recorded as such. Nothing a guest, a report or an approval
   * list can see is written.
   */
  preview?: boolean
  /** Recorded as `agent_runs.input_ref`, so a caller can find this run again. */
  inputRef?: string
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
  toolCalls: ToolCallRecord[]
  output: Record<string, unknown>
  confidence: number | null
  tierApplied: AutonomyTier
  outcome: 'auto' | null
  latencyMs: number
  model: string | null
  inputRef?: string
}

/**
 * One tool call, as recorded on the run (ADR-021).
 *
 * Every call leaves exactly one entry — executed, refused by the allow-list,
 * or held for approval — with what went in and what came out, so the audit
 * trail answers "what did the agent do with what" without re-running it. Kept
 * in `agent_runs.tool_calls` for now; a table of its own, with `reversed_by`,
 * arrives with reversal (WP0.3/0.6). The data map already puts this column on
 * the message clock and redacts it on erasure.
 */
export interface ToolCallRecord {
  tool: string
  ok: boolean
  /** `simulated`: a preview turn recorded the call without executing it (ADR-038). */
  status: 'done' | 'failed' | 'refused' | 'pending_approval' | 'simulated'
  /** The profile that chose the call, when the orchestrator ran one. */
  profile?: string | null
  input: Record<string, unknown>
  output?: Record<string, unknown>
  reversible: boolean
  /** thread + tool + input hash, on write tools (WP0.3). */
  idempotencyKey?: string
  /** The write had already been done for this key; its earlier output was returned. */
  replayed?: boolean
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
  features: FeatureCheck = createFeatureCheck(),
  llm: LlmProvider | null = listProviders()[0] ?? null,
): Promise<RunOutcome> {
  const agent = getAgent(input.agent)
  const started = Date.now()

  const toolCalls: ToolCallRecord[] = []
  // Assigned on both paths below; no initial value is ever read.
  let output: Record<string, unknown>
  let status: RunOutcome['status'] = 'accepted'
  let confidence: number | null = null

  try {
    // Feature gate (ADR-019). Inside the try so a refusal is recorded like any
    // other rejected run: "the concierge did not answer because the property
    // does not have it" is a thing an owner asks about, and the answer should
    // be a row, not an absence.
    if (!(await gateOpen(features, input.propertyId, agent.feature))) {
      throw new Error(
        `Agent ${agent.name} needs the "${agent.feature}" feature, which this property does not have.`,
      )
    }

    const context: ToolContext = {
      propertyId: input.propertyId,
      ...(input.reservationId ? { reservationId: input.reservationId } : {}),
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(input.locale ? { locale: input.locale } : {}),
      ...(input.appUrl ? { appUrl: input.appUrl } : {}),
    }

    const result = await execute(agent, input, {
      call: (tool, toolInput, profile) =>
        callTool(agent, context, tool, toolInput, toolCalls, profile, input.preview === true),
      note: (entry) =>
        toolCalls.push({
          tool: entry.tool,
          ok: false,
          // A preview never leaves an action waiting for a person (ADR-038):
          // `pending_approval` is what puts a call on the approvals list.
          status: input.preview && entry.status === 'pending_approval' ? 'simulated' : entry.status,
          profile: entry.profile,
          input: entry.input,
          reversible: getTool(entry.tool)?.reversible ?? false,
        }),
      llm,
    })

    output = input.preview ? { ...result.output, preview: true } : result.output
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
    toolCalls,
    output,
    confidence,
    tierApplied,
    // T1 acts on its own, so the outcome is `auto` — there is no human to
    // accept or reject it. A T2 run is recorded without an outcome and gains
    // one when somebody taps the diff-card.
    // A run that held an action for a person is not `auto` whatever the
    // agent's tier: its outcome is decided when somebody approves or rejects
    // it (WP0.6), and until then it is null — which is what lists it as pending.
    outcome:
      status === 'accepted' &&
      tierApplied === 'T1' &&
      !toolCalls.some((call) => call.status === 'pending_approval')
        ? 'auto'
        : null,
    latencyMs: Date.now() - started,
    // The model that actually answered, when one did; otherwise the declared
    // need. A run routed by rules alone records no model, because none ran.
    model: typeof output.model === 'string' ? output.model : null,
    ...(input.inputRef ? { inputRef: input.inputRef } : {}),
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
  log: ToolCallRecord[],
  profile: string | null = null,
  preview = false,
): Promise<ToolResult> {
  const reversible = getTool(tool)?.reversible ?? false
  const entry = { tool, profile, input: toolInput, reversible }

  if (!grantsTool(agent, tool)) {
    log.push({ ...entry, ok: false, status: 'refused' })
    throw new ToolNotGrantedError(agent.name, tool)
  }

  const implementation = getTool(tool)

  if (!implementation) {
    log.push({ ...entry, ok: false, status: 'failed' })
    throw new Error(`Tool "${tool}" is granted but not implemented.`)
  }

  /*
   * Preview (ADR-038): anything not known to be read-only is simulated — not
   * called, recorded as `simulated`, and its phrase says so. Fail-closed: a
   * tool nobody classified lands here.
   */
  if (preview && !READ_ONLY_TOOLS.has(tool)) {
    const output = {
      simulated: true,
      phrase: previewSimulatedPhrase(context.locale ?? 'en', tool),
    }
    log.push({ ...entry, ok: true, status: 'simulated', output })
    return { ok: true, output }
  }

  /*
   * Idempotency for writes (WP0.3): a guest who sends the same message twice,
   * or a job retried after a crash, must not log two complaints or send two
   * links. Keyed per thread, so the same request in another conversation is a
   * different request.
   */
  const idempotencyKey =
    implementation.write && context.threadId
      ? writeKey(context.threadId, tool, toolInput)
      : undefined

  if (idempotencyKey) {
    const earlier = await findCompletedToolCall(context.propertyId, idempotencyKey)
    if (earlier) {
      log.push({
        ...entry,
        ok: true,
        status: 'done',
        output: earlier,
        idempotencyKey,
        replayed: true,
      })
      return { ok: true, output: earlier }
    }
  }

  // The context is the scoping boundary: one property and at most one stay,
  // fixed by the runner and not readable from the agent's own input.
  const result = await implementation.run(context, toolInput)
  log.push({
    ...entry,
    ok: result.ok,
    status: result.ok ? 'done' : 'failed',
    output: result.output,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  })

  return result
}

type ToolCaller = (tool: string, input: Record<string, unknown>) => Promise<ToolResult>

/** A stable key for one write: the order of keys in the input does not change it. */
export function writeKey(threadId: string, tool: string, input: Record<string, unknown>): string {
  const canonical = (value: unknown): unknown =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value as Record<string, unknown>)
            .sort()
            .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
        )
      : value

  return createHash('sha256')
    .update(`${threadId}|${tool}|${JSON.stringify(canonical(input))}`)
    .digest('hex')
}

interface ExecuteIO {
  call: ExecuteTool
  note: NoteToolCall
  llm: LlmProvider | null
}

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
  io: ExecuteIO,
): Promise<{ output: Record<string, unknown>; confidence: number | null }> {
  // Agents other than AG-01 call tools without a profile.
  const call: ToolCaller = (tool, toolInput) => io.call(tool, toolInput, null)

  switch (agent.name) {
    /**
     * AG-01 — the guest concierge (E3.2), now the Guest Desk orchestrator
     * (ADR-021): hard rules, routing, one profile, one tool.
     *
     * Still a router, not a writer (ADR-022). Every reply is a tool's `phrase`,
     * which is what lets the tool-boundary audit keep asserting
     * `reply ⊆ tool output`. The ladder this replaced — request, knowledge base,
     * escalate — survives as the `request` route and the `general-info`
     * profile, so a property with no model sees the behaviour it had before.
     */
    case 'AG-01': {
      const message = typeof input.input.message === 'string' ? input.input.message : ''
      if (!message.trim()) throw new Error('AG-01 needs a message')

      const intentHint =
        input.input.intent === 'request' || input.input.intent === 'question'
          ? (input.input.intent as 'request' | 'question')
          : undefined

      return orchestrate(
        {
          message,
          locale: input.locale ?? 'en',
          threadId: input.threadId ?? null,
          hasBooking: input.input.hasBooking !== false,
          history: Array.isArray(input.input.history) ? (input.input.history as RoutingTurn[]) : [],
          ...(intentHint ? { intentHint } : {}),
          ...(typeof input.input.businessHours === 'string' && input.input.businessHours
            ? { businessHours: input.input.businessHours }
            : {}),
        },
        io,
      )
    }

    /** AG-06 — the owner's assistant (WP0.5): one read-only list, its phrase as the reply. */
    case 'AG-06': {
      const message = typeof input.input.message === 'string' ? input.input.message : ''
      if (!message.trim()) throw new Error('AG-06 needs a message')
      return executeOwner(message, io.call, io.llm)
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

    /**
     * AG-03 — onboarding (E7.1, 06 §2).
     *
     * One tool call. Everything it writes is a draft the owner reviews in the
     * knowledge editor, and there is no tool granted that could publish one.
     */
    case 'AG-03': {
      const result = await call('draft_knowledge', { url: input.input.url })

      if (!result.ok) throw new Error(String(result.output.error ?? 'ingestion failed'))

      return {
        output: result.output,
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
        ...(row.inputRef ? { inputRef: row.inputRef } : {}),
      })
      .returning({ id: agentRuns.id })

    if (!inserted) throw new Error('agent_runs insert returned no row')
    return inserted.id
  })
}
