import { asService, properties } from '@bookone/core/db'
import type { LlmProvider } from '@bookone/core/llm'
import { eq } from 'drizzle-orm'
import { getProfile } from './profiles'
import { PROFILE_PROMPTS } from './prompts/profiles'
import { normalise } from './router/hard-rules'
import { runAgent, type RunOutcome } from './runner'
import { getTool } from './tools'
import type { ExecuteTool } from './orchestrator'

/**
 * The owner's own assistant — AG-06 with the `owner-backoffice` profile (ADR-021).
 *
 * A separate orchestrator on a separate trigger, never a peer in a guest
 * conversation: it answers only numbers the property has recorded as its
 * owner's (`settings.ownerPhones`). Anything else is refused before a single
 * tool runs, so a guest who writes "how many arrivals tomorrow?" from their own
 * phone reaches the guest concierge, not this.
 *
 * Read-only: its four tools list, and nothing it can call changes a row.
 */

/** Digits only, so "+39 040 000 0001" and "0039040 0000001" compare equal. */
export function phoneKey(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return digits.startsWith('00') ? digits.slice(2) : digits
}

export async function isOwnerPhone(propertyId: string, phone: string): Promise<boolean> {
  const [row] = await asService((db) =>
    db
      .select({ settings: properties.settings })
      .from(properties)
      .where(eq(properties.id, propertyId))
      .limit(1),
  )
  const recorded = (row?.settings as { ownerPhones?: unknown } | undefined)?.ownerPhones
  if (!Array.isArray(recorded)) return false

  const key = phoneKey(phone)
  return (
    key.length >= 6 &&
    recorded.some((entry) => typeof entry === 'string' && phoneKey(entry) === key)
  )
}

const OWNER_VOCABULARY: [string, string[]][] = [
  [
    'list_capture_status',
    [
      'document',
      'documents',
      'documenti',
      'pre arrival',
      'pre arrivo',
      'dokumente',
      'dokumenti',
      'check in online',
    ],
  ],
  [
    'list_open_complaints',
    [
      'complaint',
      'complaints',
      'reclami',
      'reclamo',
      'lamentele',
      'beschwerde',
      'beschwerden',
      'pritozbe',
      'pritozba',
    ],
  ],
  [
    'list_pending_approvals',
    [
      'approve',
      'approval',
      'approvals',
      'approvare',
      'approvazione',
      'freigabe',
      'freigeben',
      'odobritev',
      'odobriti',
    ],
  ],
  [
    'list_arrivals',
    [
      'arrival',
      'arrivals',
      'arriving',
      'arrivi',
      'arriva',
      'arrivano',
      'anreise',
      'anreisen',
      'ankunft',
      'prihod',
      'prihodi',
    ],
  ],
]

/** The owner's question to one read-only tool, by rules — or by the model when there is one. */
export async function chooseOwnerTool(
  message: string,
  llm: LlmProvider | null,
): Promise<string | null> {
  const profile = getProfile('owner-backoffice')

  if (llm) {
    try {
      const response = await llm.complete({
        task: 'classification',
        tier: profile.modelTier,
        temperature: 0,
        maxOutputTokens: 200,
        messages: [
          { role: 'system', content: PROFILE_PROMPTS[profile.prompt] ?? '' },
          { role: 'user', content: message },
        ],
        tools: profile.tools.map((name) => ({
          name,
          description: getTool(name)?.description ?? name,
          parameters: getTool(name)?.input ?? { type: 'object', properties: {} },
        })),
      })
      const picked = response.toolCalls[0]?.name
      if (picked && profile.tools.includes(picked)) return picked
    } catch {
      // Fall back to the rules below.
    }
  }

  const text = normalise(message)
  for (const [tool, phrases] of OWNER_VOCABULARY) {
    if (phrases.some((phrase) => text.includes(normalise(phrase)))) return tool
  }
  return null
}

export type OwnerOutcome =
  | { status: 'answered'; runId: string; reply: string }
  | { status: 'not-understood'; runId: string }
  | { status: 'refused'; reason: string }

export async function respondToOwner(
  input: { propertyId: string; phone: string; message: string; locale: string },
  deps: { llm?: LlmProvider | null; run?: typeof runAgent } = {},
): Promise<OwnerOutcome> {
  if (!(await isOwnerPhone(input.propertyId, input.phone))) {
    return { status: 'refused', reason: 'not a recorded owner number' }
  }

  const run = deps.run ?? runAgent
  const outcome: RunOutcome = await run(
    {
      agent: 'AG-06',
      propertyId: input.propertyId,
      locale: input.locale,
      input: { message: input.message },
    },
    undefined,
    undefined,
    deps.llm ?? null,
  )

  const reply = typeof outcome.output.reply === 'string' ? outcome.output.reply : ''
  return reply
    ? { status: 'answered', runId: outcome.runId, reply }
    : { status: 'not-understood', runId: outcome.runId }
}

/** What AG-06 does inside the runner: one read-only tool, its phrase as the reply. */
export async function executeOwner(
  message: string,
  call: ExecuteTool,
  llm: LlmProvider | null,
): Promise<{ output: Record<string, unknown>; confidence: number | null }> {
  const tool = await chooseOwnerTool(message, llm)
  if (!tool)
    return {
      output: { profile: 'owner-backoffice', reply: '', understood: false },
      confidence: null,
    }

  const result = await call(tool, {}, 'owner-backoffice')
  const phrase = typeof result.output.phrase === 'string' ? result.output.phrase : ''

  return {
    output: { profile: 'owner-backoffice', tool, reply: result.ok ? phrase : '', understood: true },
    confidence: null,
  }
}
