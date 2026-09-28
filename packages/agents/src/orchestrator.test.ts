import { describe, expect, it } from 'vitest'
import type { LlmProvider, LlmToolCall } from '@bookone/core/llm'
import { orchestrate, type OrchestratorInput } from './orchestrator'
import { runAgent, type AgentRunRecord } from './runner'
import type { ToolResult } from './tools'

/**
 * The orchestrator's guarantees (ADR-021, ADR-022, WP0.2), against a fake tool
 * executor — the real tools read the database and these properties do not
 * depend on what they read.
 */
function harness(results: Record<string, ToolResult> = {}) {
  const executed: { tool: string; input: Record<string, unknown>; profile: string | null }[] = []
  const noted: { tool: string; status: string; profile: string | null }[] = []

  return {
    executed,
    noted,
    io: (llm: LlmProvider | null = null) => ({
      llm,
      call: async (tool: string, input: Record<string, unknown>, profile: string | null) => {
        executed.push({ tool, input, profile })
        if (tool === 'escalate') {
          return {
            ok: true,
            output: { escalate: true, phrase: `<escalate:${String(input.kind ?? 'default')}>` },
          }
        }
        if (tool === 'create_task')
          return { ok: true, output: { taskId: 't1', phrase: '<task recorded>' } }
        return results[tool] ?? { ok: false, output: { error: `${tool} not faked` } }
      },
      note: (entry: { tool: string; status: string; profile: string | null }) => noted.push(entry),
    }),
  }
}

/** A model that always picks the given tool — the adversary for the allow-list. */
function choosing(call: LlmToolCall | null, route?: Record<string, unknown>): LlmProvider {
  return {
    name: 'fake',
    residency: {
      euProcessing: true,
      region: 'test',
      subProcessorRegisterEntry: 'SP-006',
      verifiedAt: '2026-09-27',
    },
    complete: async (request) => ({
      text: '',
      toolCalls:
        request.task === 'classification'
          ? route
            ? [
                {
                  name: 'route',
                  input: { emergency: false, money: false, identity: false, ...route },
                },
              ]
            : []
          : call
            ? [call]
            : [],
      usage: { inputTokens: 0, outputTokens: 0, costCents: 0 },
      model: request.task === 'classification' ? 'fake-small' : 'fake-strong',
      stopReason: 'tool_use',
    }),
  }
}

const turn = (message: string, extra: Partial<OrchestratorInput> = {}): OrchestratorInput => ({
  message,
  locale: 'it',
  threadId: 'thread-1',
  hasBooking: true,
  history: [],
  ...extra,
})

const kbHit = { ok: true, output: { found: true, phrase: '<colazione 7:30–10>', score: 0.9 } }

describe('hard rules run before routing', () => {
  it('"voglio un rimborso" never reaches a profile, whatever the model would say', async () => {
    const h = harness({ search_knowledge: kbHit })
    const { output } = await orchestrate(
      turn('voglio un rimborso'),
      h.io(
        choosing(
          { name: 'search_knowledge', input: { question: 'x' } },
          { profile: 'general-info' },
        ),
      ),
    )

    expect(output).toMatchObject({
      action: 'escalate',
      hardRule: 'money',
      tier: 'T2',
      profile: null,
    })
    expect(h.executed.map((c) => c.tool)).toEqual(['escalate'])
  })

  it('an emergency gets the emergency phrase and stops the agent', async () => {
    const h = harness()
    const { output } = await orchestrate(
      turn('There is a fire in the corridor', { locale: 'en' }),
      h.io(),
    )

    expect(output).toMatchObject({
      hardRule: 'emergency',
      tier: 'T3',
      stop: true,
      reply: '<escalate:emergency>',
    })
  })

  it("a model's emergency flag is honoured even when the words missed it", async () => {
    const h = harness()
    const { output } = await orchestrate(
      turn('the room is filling with something'),
      h.io(choosing(null, { profile: 'general-info', emergency: true })),
    )
    expect(output).toMatchObject({ hardRule: 'emergency', stop: true })
  })
})

describe('the allow-list', () => {
  it('refuses and records a tool the profile does not list, and never runs it', async () => {
    // general-info lists only search_knowledge; the model reaches for a cancel.
    const h = harness({ search_knowledge: kbHit })
    const { output } = await orchestrate(
      turn('what time is breakfast'),
      h.io(choosing({ name: 'cancel_booking', input: {} }, { profile: 'general-info' })),
    )

    expect(h.noted).toEqual([
      { tool: 'cancel_booking', input: {}, profile: 'general-info', status: 'refused' },
    ])
    expect(h.executed.map((c) => c.tool)).toEqual(['escalate'])
    expect(output).toMatchObject({ action: 'escalate', escalate: true })
  })
})

describe('approval', () => {
  it('holds an approval-required tool for a person and tells the guest so', async () => {
    const h = harness()
    const { output } = await orchestrate(
      turn('please cancel my booking'),
      h.io(choosing({ name: 'cancel_booking', input: {} }, { profile: 'booking-support' })),
    )

    expect(h.noted).toEqual([
      { tool: 'cancel_booking', input: {}, profile: 'booking-support', status: 'pending_approval' },
    ])
    expect(h.executed.map((c) => c.tool)).toEqual(['escalate'])
    expect(output.reply).toBe('<escalate:approval>')
  })
})

describe('answers are tool phrases (ADR-022)', () => {
  it('relays the knowledge base, verbatim, at T1 — with no model at all', async () => {
    const h = harness({ search_knowledge: kbHit })
    const { output, confidence } = await orchestrate(turn('a che ora è la colazione?'), h.io())

    expect(output).toMatchObject({
      action: 'answer',
      reply: '<colazione 7:30–10>',
      profile: 'general-info',
      tier: 'T1',
    })
    expect(confidence).toBe(0.9)
  })

  it('keeps the in-stay request path: a task, then a person', async () => {
    const h = harness()
    const { output } = await orchestrate(
      turn('Could we have two more towels?', { locale: 'en' }),
      h.io(),
    )

    expect(h.executed.map((c) => c.tool)).toEqual(['create_task', 'escalate'])
    expect(output.reply).toBe('<task recorded>\n\n<escalate:default>')
  })

  it('escalates a profile that has no action without a model, rather than guessing', async () => {
    const h = harness()
    const { output } = await orchestrate(turn('We will arrive at 22:00', { locale: 'en' }), h.io())

    expect(output).toMatchObject({ profile: 'pre-arrival', action: 'escalate' })
  })

  it('always hands a logged complaint to a person, after the logging phrase', async () => {
    const h = harness({ log_complaint: { ok: true, output: { phrase: '<complaint logged>' } } })
    const { output } = await orchestrate(
      turn('the room is dirty, unacceptable', { locale: 'en' }),
      h.io(
        choosing(
          { name: 'log_complaint', input: { category: 'cleanliness', summary: 'dirty' } },
          { profile: 'complaints' },
        ),
      ),
    )

    expect(output).toMatchObject({
      escalate: true,
      reply: '<complaint logged>\n\n<escalate:default>',
    })
  })
})

describe('unknown twice', () => {
  it('goes to a person with the rule named when this turn and the last were unknown and unanswered', async () => {
    const h = harness({ search_knowledge: { ok: true, output: { found: false } } })
    const { output } = await orchestrate(
      turn('blorp', { history: [{ profile: 'general-info', unknown: true, hardRule: null }] }),
      h.io(),
    )

    expect(output).toMatchObject({ hardRule: 'unknown_twice', unknownIntent: true })
  })

  it('does not fire when the knowledge base answered', async () => {
    const h = harness({ search_knowledge: kbHit })
    const { output } = await orchestrate(
      turn('wifi?', { history: [{ profile: 'general-info', unknown: true, hardRule: null }] }),
      h.io(),
    )

    expect(output).toMatchObject({ action: 'answer', hardRule: null })
  })
})

describe('the provider is configuration', () => {
  it('two providers choosing the same tool produce the same turn', async () => {
    const a = harness({ search_knowledge: kbHit })
    const b = harness({ search_knowledge: kbHit })
    const pick = { name: 'search_knowledge', input: { question: 'breakfast' } }

    const one = await orchestrate(
      turn('breakfast?'),
      a.io(choosing(pick, { profile: 'general-info' })),
    )
    const two = await orchestrate(
      turn('breakfast?'),
      b.io({ ...choosing(pick, { profile: 'general-info' }), name: 'other' }),
    )

    expect(one.output.reply).toBe(two.output.reply)
    expect(a.executed).toEqual(b.executed)
  })
})

describe('through the runner', () => {
  it('records exactly one entry per tool call, with its input and output', async () => {
    // "I want a refund" touches no database: the hard rule escalates, and the
    // escalate tool is pure.
    const rows: AgentRunRecord[] = []
    const outcome = await runAgent(
      {
        agent: 'AG-01',
        propertyId: 'p1',
        threadId: 'thread-1',
        locale: 'en',
        input: { message: 'I want a refund' },
      },
      async (row) => {
        rows.push(row)
        return 'run-1'
      },
      async () => true,
      null,
    )

    expect(outcome.status).toBe('accepted')
    expect(rows[0]?.toolCalls).toHaveLength(1)
    expect(rows[0]?.toolCalls[0]).toMatchObject({
      tool: 'escalate',
      ok: true,
      status: 'done',
      input: { reason: 'hard rule: money' },
      reversible: false,
    })
    expect(rows[0]?.output).toMatchObject({ threadId: 'thread-1', hardRule: 'money' })
  })
})
