import 'server-only'
import { listProviders, openRouterFromEnv, registerProvider } from '@bookone/core/llm'

/**
 * The model gateway in this process, for the agent playground (ADR-037).
 *
 * The worker registers it at boot; the console runs preview turns itself, so
 * it registers the same provider, through the same residency gate, on first
 * use. No key configured means the orchestrator routes by rules alone — the
 * same fallback a guest would get, and the playground shows it.
 */
let ready = false

export function ensureAgentsReady(): void {
  if (ready) return
  ready = true
  if (listProviders().length > 0) return
  const llm = openRouterFromEnv({
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    LLM_MODEL_SMALL: process.env.LLM_MODEL_SMALL,
    LLM_MODEL_STRONG: process.env.LLM_MODEL_STRONG,
    OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL,
  })
  if (llm) registerProvider(llm)
}
