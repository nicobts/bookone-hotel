import { describe, expect, it } from 'vitest'
import {
  agentActor,
  formatActor,
  guestActor,
  isAgentActor,
  parseActor,
  systemActor,
  userActor,
} from './actor'

describe('formatActor', () => {
  it('uses the agent: prefix ADR-011 requires', () => {
    // The audit trail is built on this exact string. An agent run that did not
    // say `agent:` would be indistinguishable from a human one, which is the
    // property the whole autonomy model rests on.
    expect(formatActor(agentActor('AG-05'))).toBe('agent:AG-05')
  })

  it('formats the other three kinds', () => {
    expect(formatActor(userActor('4f6c'))).toBe('user:4f6c')
    expect(formatActor(guestActor('9a1b'))).toBe('guest:9a1b')
    expect(formatActor(systemActor)).toBe('system')
  })
})

describe('parseActor', () => {
  it('round-trips every kind', () => {
    const actors = [userActor('4f6c'), agentActor('AG-01'), guestActor('9a1b'), systemActor]

    for (const actor of actors) {
      expect(parseActor(formatActor(actor))).toEqual(actor)
    }
  })

  it('keeps a uuid containing no colon intact', () => {
    const id = '6d834e05-fb79-419e-8480-c7fabbe0d4ea'
    expect(parseActor(`user:${id}`)).toEqual({ kind: 'user', userId: id })
  })

  it('returns null rather than throwing on anything unrecognised', () => {
    // This parses rows that may have been written by an older version. A
    // reporting query should degrade on one odd row, not fail entirely.
    for (const value of ['', 'nonsense', 'robot:x', ':x', 'user:', 'user']) {
      expect(parseActor(value)).toBeNull()
    }
  })
})

describe('isAgentActor', () => {
  it('identifies agent rows and nothing else', () => {
    expect(isAgentActor('agent:AG-02')).toBe(true)
    expect(isAgentActor('user:4f6c')).toBe(false)
    expect(isAgentActor('system')).toBe(false)
    expect(isAgentActor('agentic:thing')).toBe(false)
  })
})
