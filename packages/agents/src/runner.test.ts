import { describe, expect, it } from 'vitest'
import { runAgent, type AgentRunRecord } from './runner'
import { AG_05, getAgent, grantsTool } from './registry'

/**
 * The runner's guardrails (06-AI-AGENT-LAYER §4).
 *
 * These are what make "no unauthorized capability" a property of the system
 * rather than of a prompt, so they are tested directly rather than inferred
 * from an agent behaving well.
 */

/** Captures what would have been written, instead of writing it. */
function recorder() {
  const rows: AgentRunRecord[] = []

  const record = async (row: AgentRunRecord) => {
    rows.push(row)
    return `run-${rows.length}`
  }

  return { record, rows }
}

/** Every feature on. The gate itself is tested below; the rest are not about it. */
const allOn = async () => true

const divergent = {
  ours: {
    arrivalDate: '2026-09-10',
    departureDate: '2026-09-13',
    totalCents: 36_000,
    roomTypeCode: 'DBL',
  },
  theirs: {
    externalId: 'ERI-000001',
    roomTypeCode: 'SGL',
    arrivalDate: '2026-09-10',
    departureDate: '2026-09-13',
    guestName: 'Guest',
    status: 'confirmed',
    totalCents: 36_000,
    currency: 'EUR',
  },
}

describe('a successful run', () => {
  it('classifies and records the tool call', async () => {
    const { record, rows } = recorder()

    const outcome = await runAgent(
      { agent: 'AG-05', propertyId: 'p1', input: divergent },
      record,
      allOn,
    )

    expect(outcome.status).toBe('accepted')
    expect(outcome.output.class).toBe('logic')
    expect(outcome.toolCalls).toEqual([{ tool: 'classify_discrepancy', ok: true }])
    expect(rows).toHaveLength(1)
  })

  it('records outcome=auto for a T1 agent', async () => {
    // T1 acts on its own, so there is no human to accept it. A T2 run would be
    // recorded with a null outcome and gain one when somebody taps the card.
    const { record, rows } = recorder()

    await runAgent({ agent: 'AG-05', propertyId: 'p1', input: divergent }, record, allOn)

    expect(rows[0]?.tierApplied).toBe('T1')
    expect(rows[0]?.outcome).toBe('auto')
  })

  it('records the trigger event so a run links back to its cause', async () => {
    const { record, rows } = recorder()

    await runAgent(
      { agent: 'AG-05', propertyId: 'p1', triggerEventId: 42n, input: divergent },
      record,
      allOn,
    )

    expect(rows[0]?.triggerEventId).toBe(42n)
  })

  it('records no model for an agent that needs none', async () => {
    // Deciding whether two amounts differ by under a euro is arithmetic. A
    // model would be slower, cost money, and occasionally be wrong about
    // subtraction.
    const { record, rows } = recorder()

    await runAgent({ agent: 'AG-05', propertyId: 'p1', input: divergent }, record, allOn)

    expect(rows[0]?.model).toBeNull()
  })
})

describe('tool grants', () => {
  it('grants only what the registry declares', () => {
    expect(grantsTool(AG_05, 'classify_discrepancy')).toBe(true)
    expect(grantsTool(AG_05, 'refund_payment')).toBe(false)
    // Fiscal-adjacent tools do not exist as implementations either. Enforced
    // by absence, not by policy (ADR-002 / D11).
    expect(grantsTool(AG_05, 'issue_invoice')).toBe(false)
  })

  it('refuses an unknown agent rather than defaulting', () => {
    // A trigger wired to a non-existent agent is a bug. Running a default in
    // its place would hide that behind plausible output.
    expect(() => getAgent('AG-99')).toThrow(/Unknown agent/)
  })
})

describe('a failed run', () => {
  it('is still recorded', async () => {
    // An audit trail with gaps where things went wrong is an audit trail of
    // the successes, which is the least useful subset.
    const { record, rows } = recorder()

    const outcome = await runAgent(
      { agent: 'AG-05', propertyId: 'p1', input: { ours: divergent.ours } },
      record,
      allOn,
    )

    expect(outcome.status).toBe('rejected')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.outcome).toBeNull()
    expect(rows[0]?.output.error).toBeDefined()
  })

  it('carries the reason into the record', async () => {
    const { record, rows } = recorder()

    await runAgent({ agent: 'AG-05', propertyId: 'p1', input: {} }, record, allOn)

    expect(String(rows[0]?.output.error)).toMatch(/required/)
  })
})

describe('property scoping', () => {
  it('records the property the runner was given', async () => {
    // The context carries exactly one property, fixed by the runner and not
    // readable from the agent's own input — a cross-tenant tool call has no
    // expressible form.
    const { record, rows } = recorder()

    await runAgent(
      {
        agent: 'AG-05',
        propertyId: 'p1',
        // A hostile input naming another property changes nothing.
        input: { ...divergent, propertyId: 'p2' },
      },
      record,
      allOn,
    )

    expect(rows[0]?.propertyId).toBe('p1')
  })
})

describe('the feature gate (ADR-019)', () => {
  it('refuses an agent whose feature the property lacks, and records the refusal', async () => {
    // AG-05 needs `pms_sync`. A property without it gets no classification and
    // no tool call — and a row that says why, rather than silence.
    const { record, rows } = recorder()
    const asked: string[] = []

    const outcome = await runAgent(
      { agent: 'AG-05', propertyId: 'p1', input: divergent },
      record,
      async (propertyId, feature) => {
        asked.push(`${propertyId}:${feature}`)
        return false
      },
    )

    expect(outcome.status).toBe('rejected')
    expect(outcome.toolCalls).toEqual([])
    expect(asked).toEqual(['p1:pms_sync'])
    expect(rows).toHaveLength(1)
    expect(String(rows[0]?.output.error)).toMatch(/pms_sync/)
  })

  it('classifies every agent', () => {
    // The concierge is a module a property buys; the attribution auditor checks
    // what BookOne billed and is never switched off by a flag.
    expect(getAgent('AG-01').feature).toBe('concierge')
    expect(getAgent('AG-05').feature).toBe('pms_sync')
    expect(getAgent('AG-07').feature).toBe('core')
    expect(getAgent('AG-03').feature).toBe('core')
  })
})
