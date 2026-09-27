import { traceModelCall } from '../telemetry'
import { generateText, jsonSchema, tool, type ModelMessage, type ToolSet } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type {
  LlmProvider,
  LlmRequest,
  LlmResponse,
  ModelTier,
  ResidencyDeclaration,
} from './provider'

/**
 * OpenRouter behind `LlmProvider` (ADR-023, ADR-029).
 *
 * The AI SDK is an implementation detail of this file. Nothing outside
 * `@bookone/core/llm` imports it — eslint enforces that — so the rest of the
 * product sees `complete()` and nothing else.
 *
 * ## Tools are declared, never executed here
 *
 * Tool schemas are passed without an `execute`, so the SDK stops at the model's
 * tool call and hands it back. Running the tool is the agent runner's job: it
 * checks the grant, scopes the call to one property and records it. A tool the
 * SDK executed on its own would bypass all three.
 *
 * ## Residency
 *
 * Declared as non-EU processing under ADR-029, with the register entry that
 * says so. Every request asks for zero data retention and no data collection;
 * moving to EU in-region routing is a change of `baseURL`.
 */
export interface OpenRouterConfig {
  apiKey: string
  /** Model id per tier, e.g. `{ small: '…', strong: '…' }`. Configuration, never code. */
  models: Record<ModelTier, string>
  /** Defaults to OpenRouter's global endpoint. `https://eu.openrouter.ai/api/v1` for EU routing. */
  baseURL?: string
}

export const OPENROUTER_RESIDENCY: ResidencyDeclaration = {
  euProcessing: false,
  region: 'global (OpenRouter routing, ZDR endpoints only)',
  subProcessorRegisterEntry: 'SP-006',
  verifiedAt: '2026-09-27',
  transferException: 'ADR-029',
}

/** Classification is cheap and frequent; everything else needs the stronger model. */
export function tierFor(request: Pick<LlmRequest, 'task' | 'tier'>): ModelTier {
  return request.tier ?? (request.task === 'classification' ? 'small' : 'strong')
}

export function createOpenRouterProvider(config: OpenRouterConfig): LlmProvider {
  const openrouter = createOpenRouter({
    apiKey: config.apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
  })

  return {
    name: 'openrouter',
    residency: OPENROUTER_RESIDENCY,

    async complete(request: LlmRequest): Promise<LlmResponse> {
      const modelId = config.models[tierFor(request)]

      const model = openrouter.chat(modelId, {
        // Only endpoints that keep nothing, and none that train on it.
        provider: { zdr: true, data_collection: 'deny' },
      })

      const tools: ToolSet = {}
      for (const schema of request.tools ?? []) {
        tools[schema.name] = tool({
          description: schema.description,
          inputSchema: jsonSchema(schema.parameters),
        })
      }

      const system = request.messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n\n')
      const messages: ModelMessage[] = request.messages
        .filter((m) => m.role !== 'system')
        .map((m): ModelMessage =>
          m.role === 'user' && m.images?.length
            ? {
                role: 'user',
                content: [
                  { type: 'text', text: m.content },
                  ...m.images.map((image) => ({
                    type: 'file' as const,
                    data: image.data,
                    mediaType: image.mediaType,
                  })),
                ],
              }
            : { role: m.role as 'user' | 'assistant', content: m.content },
        )

      // A GenAI span per call (ADR-036): model, task, tokens — never the
      // prompt or completion. The AI SDK's own `experimental_telemetry` stays
      // off because it records both.
      const result = await traceModelCall(
        { system: 'openrouter', model: modelId, task: request.task },
        () =>
          generateText({
            model,
            ...(system ? { system } : {}),
            messages,
            ...(request.tools?.length ? { tools, toolChoice: 'required' as const } : {}),
            ...(request.maxOutputTokens !== undefined
              ? { maxOutputTokens: request.maxOutputTokens }
              : {}),
            ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
            ...(request.signal ? { abortSignal: request.signal } : {}),
          }),
        (r) => ({
          inputTokens: r.usage.inputTokens ?? 0,
          outputTokens: r.usage.outputTokens ?? 0,
        }),
      )

      return {
        text: result.text,
        toolCalls: result.toolCalls.map((call) => ({
          name: call.toolName,
          input:
            call.input !== null && typeof call.input === 'object'
              ? (call.input as Record<string, unknown>)
              : {},
        })),
        usage: {
          inputTokens: result.usage.inputTokens ?? 0,
          outputTokens: result.usage.outputTokens ?? 0,
          // OpenRouter bills per model; the price is not in the response we
          // read. Zero is "not measured", and budgets must not treat it as free.
          costCents: 0,
        },
        model: modelId,
        stopReason:
          result.finishReason === 'tool-calls'
            ? 'tool_use'
            : result.finishReason === 'length'
              ? 'max_tokens'
              : result.finishReason === 'content-filter'
                ? 'refusal'
                : 'end',
      }
    },
  }
}

/**
 * The provider the environment configures, or none.
 *
 * `null` without a key is the normal state in CI and on a fresh checkout: the
 * orchestrator then routes deterministically, and says so in its runs.
 */
export interface OpenRouterEnv {
  OPENROUTER_API_KEY?: string | undefined
  LLM_MODEL_SMALL?: string | undefined
  LLM_MODEL_STRONG?: string | undefined
  OPENROUTER_BASE_URL?: string | undefined
}

export function openRouterFromEnv(env: OpenRouterEnv): LlmProvider | null {
  const apiKey = env.OPENROUTER_API_KEY?.trim()
  if (!apiKey) return null

  const small = env.LLM_MODEL_SMALL?.trim()
  const strong = env.LLM_MODEL_STRONG?.trim()
  if (!small || !strong) {
    throw new Error(
      'OPENROUTER_API_KEY is set but LLM_MODEL_SMALL / LLM_MODEL_STRONG are not. The model per tier is configuration (ADR-023).',
    )
  }

  const baseURL = env.OPENROUTER_BASE_URL?.trim()

  return createOpenRouterProvider({
    apiKey,
    models: { small, strong },
    ...(baseURL ? { baseURL } : {}),
  })
}
