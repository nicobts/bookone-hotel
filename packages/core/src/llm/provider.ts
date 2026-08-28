/**
 * The only path to a model, anywhere in the codebase (ADR-012, D18).
 *
 * Nothing outside `packages/core/src/llm` imports a vendor SDK — enforced by
 * the `no-restricted-imports` rule in eslint.config.mjs, so it is a build
 * failure rather than a convention.
 *
 * Three things this buys, each of which is a requirement rather than a nicety:
 *
 *   - **Residency.** EU processing is verified per provider and registered in
 *     the sub-processor register *before* a key is set (D9). The registry below
 *     refuses to hand out a provider that has not been.
 *   - **Cost.** Every call reports its cost, which lands in `agent_runs.cost_cents`.
 *     Agent COGS is a first-class metric (≤ €0.40 per stay, 06 §6) and cannot be
 *     reconstructed after the fact.
 *   - **Swappability.** The model landscape moves quarterly and different tasks
 *     want different price/quality points. Task-tiered config lives in the agent
 *     registry; this interface is what makes it a config change.
 */

/**
 * What an agent is asking the model to do.
 *
 * Task-tiered rather than model-named, so the registry can point `extraction`
 * at something cheap and `conversation` at something strong without any agent
 * knowing a model id.
 */
export type LlmTask =
  /** Pull structured fields out of a document. Cheap, narrow, high volume. */
  | 'extraction'
  /** Put something in a bucket. Cheapest tier. */
  | 'classification'
  /** Talk to a guest. The one place quality is worth paying for. */
  | 'conversation'
  /** Draft something a human will review. */
  | 'drafting'

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmRequest {
  task: LlmTask
  messages: LlmMessage[]
  /** Hard ceiling. A runaway generation is a cost incident, not a bug report. */
  maxOutputTokens?: number
  temperature?: number
  /** Tool schemas the model may call. The runner enforces the grants. */
  tools?: LlmToolSchema[]
  signal?: AbortSignal
}

export interface LlmToolSchema {
  name: string
  description: string
  /** JSON Schema. */
  parameters: Record<string, unknown>
}

export interface LlmToolCall {
  name: string
  input: Record<string, unknown>
}

export interface LlmResponse {
  text: string
  toolCalls: LlmToolCall[]
  usage: LlmUsage
  /** The concrete model that served this, for the `agent_runs` row. */
  model: string
  stopReason: 'end' | 'max_tokens' | 'tool_use' | 'refusal'
}

export interface LlmUsage {
  inputTokens: number
  outputTokens: number
  /**
   * Integer cents, like every other amount in this codebase. Rounded once, at
   * the edge, by the provider that knows its own pricing — never recomputed
   * downstream from token counts and a hardcoded rate that will go stale.
   */
  costCents: number
}

export interface LlmProvider {
  /** Registry key, e.g. `anthropic`. */
  readonly name: string

  /**
   * Whether this provider's processing happens in the EU, and the evidence.
   *
   * Not a boolean the caller sets: the provider asserts it about itself, the
   * registry refuses anything false, and the register entry names what was
   * checked. D9 is not negotiable and this is where it stops being a promise.
   */
  readonly residency: ResidencyDeclaration

  complete(request: LlmRequest): Promise<LlmResponse>
}

export interface ResidencyDeclaration {
  euProcessing: boolean
  /** Region or endpoint the request actually goes to, e.g. `eu-central-1`. */
  region: string
  /** Where this is recorded in the sub-processor register. */
  subProcessorRegisterEntry: string
  /** ISO date the claim was last verified by a human. */
  verifiedAt: string
}

export class ResidencyError extends Error {
  constructor(provider: string, reason: string) {
    super(`LLM provider "${provider}" refused: ${reason} (D9, ADR-012).`)
    this.name = 'ResidencyError'
  }
}
