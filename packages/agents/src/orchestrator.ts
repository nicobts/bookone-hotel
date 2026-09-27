import type { RoutingTurn } from '@bookone/core/concierge'
import type { LlmProvider } from '@bookone/core/llm'
import { getProfile, type Profile } from './profiles'
import { PROFILE_PROMPTS } from './prompts/profiles'
import { applyHardRules, type HardRuleDecision } from './router/hard-rules'
import { route, type Route } from './router/route'
import { getTool, type ToolResult } from './tools'

/**
 * The guest-conversation orchestrator (ADR-021, ADR-022) — what AG-01 runs.
 *
 * One turn, in a fixed order:
 *
 *   1. **Hard rules on the words.** Emergency, money, identity. A hit ends the
 *      turn: a person is involved and no profile is consulted.
 *   2. **Routing** to one profile (rules, or a model when one is registered).
 *      The model's own reading can add a hard rule here; it cannot remove one.
 *   3. **The profile** picks one tool from its allow-list — the model when there
 *      is one, a fixed choice when there is not — and the runner executes it.
 *   4. **"Unknown twice"** — nothing routed this turn or the last one, and
 *      nothing answered: a person, with the thread.
 *
 * Every sentence the guest reads is a tool's `phrase` (ADR-022). The
 * orchestrator composes nothing; when two phrases are sent, they are joined by
 * a blank line and nothing else.
 */

/** A tool call the runner executes, grant-checked, scoped and recorded. */
export type ExecuteTool = (
  tool: string,
  input: Record<string, unknown>,
  profile: string | null,
) => Promise<ToolResult>

/** A call recorded without being executed: refused, or waiting for approval. */
export type NoteToolCall = (entry: {
  tool: string
  input: Record<string, unknown>
  profile: string | null
  status: 'refused' | 'pending_approval'
}) => void

export interface OrchestratorInput {
  message: string
  locale: string
  threadId: string | null
  hasBooking: boolean
  history: RoutingTurn[]
  intentHint?: 'request' | 'question'
  businessHours?: string
}

export interface OrchestratorIO {
  call: ExecuteTool
  note: NoteToolCall
  llm: LlmProvider | null
}

export interface OrchestratorOutput {
  output: Record<string, unknown>
  confidence: number | null
}

export async function orchestrate(
  input: OrchestratorInput,
  io: OrchestratorIO,
): Promise<OrchestratorOutput> {
  const hours = input.businessHours ? { businessHours: input.businessHours } : {}
  const recorded = { threadId: input.threadId }

  async function escalate(
    reason: string,
    extra: {
      kind?: 'emergency' | 'approval'
      profile?: string | null
      hard?: HardRuleDecision
      route?: Route
      unknownIntent?: boolean
      prefix?: string
    },
  ): Promise<OrchestratorOutput> {
    const handed = await io.call(
      'escalate',
      { reason, ...(extra.kind ? { kind: extra.kind } : hours) },
      extra.profile ?? null,
    )

    return {
      output: {
        ...recorded,
        action: 'escalate',
        escalate: true,
        reason,
        reply: [extra.prefix, handed.output.phrase].filter(Boolean).join('\n\n'),
        profile: extra.profile ?? null,
        hardRule: extra.hard?.rule ?? null,
        tier: extra.hard?.tier ?? 'T2',
        stop: extra.hard?.stop ?? false,
        unknownIntent: extra.unknownIntent ?? false,
        routeSource: extra.route?.source ?? null,
        model: extra.route?.model ?? null,
      },
      confidence: null,
    }
  }

  // 1. Hard rules on the words, before anything else runs.
  const onWords = applyHardRules({ message: input.message, previousUnknown: false })
  if (onWords) {
    return escalate(`hard rule: ${onWords.rule}`, {
      hard: onWords,
      ...(onWords.rule === 'emergency' ? { kind: 'emergency' as const } : {}),
    })
  }

  // 2. Routing. The model, if any, may add a hard rule the words missed.
  const routed = await route(
    input.message,
    {
      hasBooking: input.hasBooking,
      previousProfile: input.history[0]?.profile ?? null,
      ...(input.intentHint ? { intentHint: input.intentHint } : {}),
    },
    io.llm,
  )

  const onModel = applyHardRules({
    message: '',
    previousUnknown: false,
    modelFlags: routed.modelFlags,
  })
  if (onModel) {
    return escalate(`hard rule: ${onModel.rule} (model)`, {
      hard: onModel,
      route: routed,
      ...(onModel.rule === 'emergency' ? { kind: 'emergency' as const } : {}),
    })
  }

  // An in-stay request for a thing: recorded as a task, and a person told.
  if (routed.target === 'request') {
    const task = await io.call('create_task', { summary: input.message }, null)
    const handed = await io.call(
      'escalate',
      { reason: 'guest request needs a person', ...hours },
      null,
    )

    return {
      output: {
        ...recorded,
        action: 'task',
        escalate: true,
        reason: 'guest request needs a person',
        taskId: task.output.taskId ?? null,
        reply: [task.output.phrase, handed.output.phrase].filter(Boolean).join('\n\n'),
        profile: 'request',
        hardRule: null,
        tier: 'T2',
        stop: false,
        unknownIntent: false,
        routeSource: routed.source,
        model: routed.model,
      },
      confidence: null,
    }
  }

  // 3. The profile.
  const profile = getProfile(routed.target)
  const choice = await chooseTool(profile, input, io.llm)

  const unknownTwice = () =>
    routed.unknown && input.history[0]?.unknown === true
      ? applyHardRules({ message: '', previousUnknown: true, unknownNow: true })
      : null

  if (!choice) {
    const hard = unknownTwice()
    return escalate(hard ? 'hard rule: unknown_twice' : `${profile.id}: no action available`, {
      profile: profile.id,
      route: routed,
      unknownIntent: routed.unknown,
      ...(hard ? { hard } : {}),
    })
  }

  // The allow-list. A tool the profile does not list is never executed.
  if (!profile.tools.includes(choice.tool)) {
    io.note({ tool: choice.tool, input: choice.input, profile: profile.id, status: 'refused' })
    return escalate(`${profile.id}: "${choice.tool}" is not in this profile's tools`, {
      profile: profile.id,
      route: routed,
    })
  }

  // Approval. Recorded, not executed; a person decides (T2).
  if (profile.approvalRequired.includes(choice.tool)) {
    io.note({
      tool: choice.tool,
      input: choice.input,
      profile: profile.id,
      status: 'pending_approval',
    })
    return escalate(`${profile.id}: "${choice.tool}" needs approval`, {
      kind: 'approval',
      profile: profile.id,
      route: routed,
    })
  }

  const result = await io.call(choice.tool, choice.input, profile.id)
  const phrase = typeof result.output.phrase === 'string' ? result.output.phrase : null
  const answered =
    result.ok &&
    phrase !== null &&
    (choice.tool !== 'search_knowledge' || result.output.found === true)

  if (!answered) {
    const hard = unknownTwice()
    const reason =
      typeof result.output.reason === 'string'
        ? result.output.reason
        : typeof result.output.error === 'string'
          ? result.output.error
          : `${profile.id}: ${choice.tool} gave no answer`

    return escalate(hard ? 'hard rule: unknown_twice' : reason, {
      profile: profile.id,
      route: routed,
      unknownIntent: routed.unknown,
      ...(hard ? { hard } : {}),
    })
  }

  // Complaints are always seen by a person, even when logged cleanly (T2).
  if (profile.id === 'complaints') {
    return escalate('complaint logged', { profile: profile.id, route: routed, prefix: phrase })
  }

  return {
    output: {
      ...recorded,
      action: 'answer',
      escalate: false,
      reply: phrase,
      profile: profile.id,
      tool: choice.tool,
      topic: result.output.topic ?? null,
      articleId: result.output.articleId ?? null,
      articleVersion: result.output.version ?? null,
      hardRule: null,
      tier: 'T1',
      stop: false,
      unknownIntent: false,
      routeSource: routed.source,
      model: routed.model,
    },
    // Retrieval confidence when the tool reports one — never a model's
    // opinion of itself.
    confidence: typeof result.output.score === 'number' ? result.output.score : null,
  }
}

/**
 * The profile's choice of tool.
 *
 * With a model: the profile's prompt and its tools' schemas, and the model
 * picks one and fills its arguments. Its choice is checked against the
 * allow-list by the caller — the model is offered only the profile's tools, and
 * the check is there for the day that stops being true.
 *
 * Without one: a fixed choice where a safe one exists, which today is a
 * knowledge-base search with the guest's own words. Every other profile needs
 * arguments only a model could extract, so it has no action and the turn goes
 * to a person — the correct direction to fail in.
 */
async function chooseTool(
  profile: Profile,
  input: OrchestratorInput,
  llm: LlmProvider | null,
): Promise<{ tool: string; input: Record<string, unknown> } | null> {
  const fallback = profile.tools.includes('search_knowledge')
    ? { tool: 'search_knowledge', input: { question: input.message } }
    : null

  if (!llm) return fallback

  try {
    const response = await llm.complete({
      task: 'extraction',
      tier: profile.modelTier,
      maxOutputTokens: 300,
      temperature: 0,
      messages: [
        { role: 'system', content: PROFILE_PROMPTS[profile.prompt] ?? '' },
        { role: 'user', content: input.message },
      ],
      tools: profile.tools.map((name) => {
        const tool = getTool(name)
        return {
          name,
          description: tool?.description ?? name,
          parameters: tool?.input ?? { type: 'object', properties: {} },
        }
      }),
    })

    const call = response.toolCalls[0]
    return call ? { tool: call.name, input: call.input } : fallback
  } catch {
    return fallback
  }
}
