import { and, eq, gte, sql } from 'drizzle-orm'
import { asService } from '../db/session'
import { agentRuns, messages } from '../db/schema'

/**
 * The tool-boundary audit (E3.2 acceptance criterion, ADR-009, binding rule 7).
 *
 * Rule 7 says nothing guest-facing may state a fact no tool produced. That is a
 * promise, and a promise nobody measures is a preference. This module is the
 * measurement: it re-reads what the concierge actually said, against the tool
 * outputs of the run that said it, and counts the sentences that cannot be
 * accounted for. The sprint gate is **zero**.
 *
 * ## Why it runs after the fact rather than blocking the reply
 *
 * Both, in the end — the concierge is built so that a reply *is* a tool phrase,
 * so the constraint is structural and this audit should find nothing. That is
 * exactly why it is worth running. A structural guarantee is only a guarantee
 * while the structure holds, and the way it stops holding is somebody adding a
 * helpful sentence to a prompt eighteen months from now. This job is what
 * notices.
 *
 * ## Two checks, deliberately different in strictness
 *
 * **Sourcing.** The reply text must appear within the concatenated tool output
 * of its own run. This is strict, and it holds today because replies are
 * assembled from `phrase` fields verbatim. If a model is ever allowed to
 * paraphrase, this check is what has to be consciously relaxed — and relaxing
 * it is a decision with an ADR behind it, not a quiet edit.
 *
 * **Numbers.** Every digit-bearing token the guest reads must appear in a tool
 * output. This survives paraphrase, and it catches the failure that actually
 * costs a property money: an invented time, price, room number or date. A model
 * that rephrases "breakfast is served until 10:00" politely is a nuisance; one
 * that says 10:30 is a guest at a locked buffet.
 */

export type ViolationKind =
  /** The reply says something that appears in no tool output of its run. */
  | 'unsourced_reply'
  /** A number in the reply that no tool produced. The expensive one. */
  | 'unsourced_number'
  /** An agent message with no run attached — nothing to audit it against. */
  | 'no_run'

export interface Violation {
  kind: ViolationKind
  messageId: string
  threadId: string
  agentRunId: string | null
  /** The number or fragment that could not be sourced. */
  detail: string
}

/**
 * Digit-bearing tokens, with the shapes a guest reads kept whole.
 *
 * `07:30`, `10.50`, `2026-09-12` and `12/09` each stay one token, because
 * splitting them would let "10:30" pass on the strength of a tool having said
 * "10:00" somewhere.
 */
export function numbersIn(text: string): string[] {
  return text.match(/\d+(?:[.,:/-]\d+)*/g) ?? []
}

/**
 * Fold text for comparison without losing the numbers.
 *
 * Whitespace and case only. Deliberately not stripping punctuation: `10:30` and
 * `1030` are different claims and a comparison that conflates them defeats the
 * check.
 */
function fold(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Everything a run's tools returned, flattened into one string.
 *
 * The whole output is used, not only the `phrase` fields. A tool that returns a
 * structured price alongside its sentence has produced that number, and the
 * check is about provenance rather than presentation.
 */
export function flattenToolOutputs(toolCalls: unknown): string {
  if (!Array.isArray(toolCalls)) return ''

  const parts: string[] = []

  const walk = (value: unknown): void => {
    if (value === null || value === undefined) return
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      parts.push(String(value))
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (typeof value === 'object') {
      for (const item of Object.values(value as Record<string, unknown>)) walk(item)
    }
  }

  walk(toolCalls)

  return parts.join(' ')
}

export interface AuditableMessage {
  messageId: string
  threadId: string
  agentRunId: string | null
  body: string
  /** `agent_runs.tool_calls` and `agent_runs.output` for the run that wrote it. */
  runEvidence: unknown
}

/** Check one message. Pure, so the rule is tested without a database. */
export function auditMessage(message: AuditableMessage): Violation[] {
  if (!message.agentRunId) {
    return [
      {
        kind: 'no_run',
        messageId: message.messageId,
        threadId: message.threadId,
        agentRunId: null,
        detail: 'agent message with no run to audit against',
      },
    ]
  }

  const evidence = fold(flattenToolOutputs(message.runEvidence))
  const violations: Violation[] = []

  if (!evidence.includes(fold(message.body))) {
    violations.push({
      kind: 'unsourced_reply',
      messageId: message.messageId,
      threadId: message.threadId,
      agentRunId: message.agentRunId,
      detail: message.body.slice(0, 200),
    })
  }

  for (const number of numbersIn(message.body)) {
    if (!evidence.includes(number.toLowerCase())) {
      violations.push({
        kind: 'unsourced_number',
        messageId: message.messageId,
        threadId: message.threadId,
        agentRunId: message.agentRunId,
        detail: number,
      })
    }
  }

  return violations
}

export interface AuditReport {
  propertyId: string
  checked: number
  violations: Violation[]
}

/**
 * Audit every agent reply a property sent since a cutoff.
 *
 * Scoped by property even under the service role (binding rule 3), and run per
 * property rather than globally so the report an owner sees is theirs.
 */
export async function auditToolBoundary(input: {
  propertyId: string
  since: Date
}): Promise<AuditReport> {
  const rows = await asService((db) =>
    db
      .select({
        messageId: messages.id,
        threadId: messages.threadId,
        agentRunId: messages.agentRunId,
        body: messages.body,
        toolCalls: agentRuns.toolCalls,
        output: agentRuns.output,
      })
      .from(messages)
      // Left join on purpose: an agent message whose run is missing is itself a
      // finding (`no_run`), and an inner join would hide exactly the rows the
      // audit exists to catch.
      .leftJoin(agentRuns, eq(agentRuns.id, messages.agentRunId))
      .where(
        and(
          eq(messages.propertyId, input.propertyId),
          eq(messages.author, 'agent'),
          gte(messages.createdAt, input.since),
        ),
      ),
  )

  const violations = rows.flatMap((row) =>
    auditMessage({
      messageId: row.messageId,
      threadId: row.threadId,
      agentRunId: row.agentRunId,
      body: row.body,
      runEvidence: [row.toolCalls, row.output],
    }),
  )

  return { propertyId: input.propertyId, checked: rows.length, violations }
}

/** Properties that sent an agent reply in the window — the audit's work list. */
export async function propertiesWithAgentReplies(since: Date): Promise<string[]> {
  const rows = await asService((db) =>
    db
      .selectDistinct({ propertyId: messages.propertyId })
      .from(messages)
      .where(and(eq(messages.author, 'agent'), gte(messages.createdAt, since))),
  )

  return rows.map((row) => row.propertyId)
}

/** Agent replies sent in a window, for the KPI in 06 §2. */
export async function countAgentReplies(propertyId: string, since: Date): Promise<number> {
  const [row] = await asService((db) =>
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(
        and(
          eq(messages.propertyId, propertyId),
          eq(messages.author, 'agent'),
          gte(messages.createdAt, since),
        ),
      ),
  )

  return row?.count ?? 0
}
