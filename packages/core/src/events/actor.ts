/**
 * Who did it.
 *
 * `domain_events.actor` is text rather than a foreign key because the set of
 * things that can act is open and heterogeneous: an agent is not a row in any
 * users table, a guest never holds an account (ADR-007), and the sync engine is
 * not a person at all. A foreign key would have to point at four tables.
 *
 * Text with no structure would rot, though, so the structure lives here: every
 * actor is minted through one of these constructors and read back through
 * `parseActor`. Nothing formats the string by hand.
 */

export type Actor =
  | { kind: 'user'; userId: string }
  /** ADR-011 requires exactly this prefix; the audit trail is built on it. */
  | { kind: 'agent'; agent: string }
  /** A guest acting through a stay token — scoped to one reservation. */
  | { kind: 'guest'; reservationId: string }
  /** Jobs with no human behind them: sync, reconciliation, retention. */
  | { kind: 'system' }

export function userActor(userId: string): Actor {
  return { kind: 'user', userId }
}

export function agentActor(agent: string): Actor {
  return { kind: 'agent', agent }
}

export function guestActor(reservationId: string): Actor {
  return { kind: 'guest', reservationId }
}

export const systemActor: Actor = { kind: 'system' }

export function formatActor(actor: Actor): string {
  switch (actor.kind) {
    case 'user':
      return `user:${actor.userId}`
    case 'agent':
      return `agent:${actor.agent}`
    case 'guest':
      return `guest:${actor.reservationId}`
    case 'system':
      return 'system'
  }
}

/**
 * Reads an actor string back into its parts.
 *
 * Returns null rather than throwing on anything unrecognised: this parses rows
 * that may have been written by an older version of the code, and a reporting
 * query should degrade rather than fail on one odd row.
 */
export function parseActor(value: string): Actor | null {
  if (value === 'system') return systemActor

  const separator = value.indexOf(':')
  if (separator < 1) return null

  const prefix = value.slice(0, separator)
  const rest = value.slice(separator + 1)
  if (!rest) return null

  switch (prefix) {
    case 'user':
      return { kind: 'user', userId: rest }
    case 'agent':
      return { kind: 'agent', agent: rest }
    case 'guest':
      return { kind: 'guest', reservationId: rest }
    default:
      return null
  }
}

/** True when the row was written by an agent — the audit query ADR-011 needs. */
export function isAgentActor(value: string): boolean {
  return parseActor(value)?.kind === 'agent'
}
