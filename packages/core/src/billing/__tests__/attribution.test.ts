import { describe, expect, it } from 'vitest'
import { ATTRIBUTION_WINDOW_HOURS, decideAttribution, type WindowTouch } from '../attribution'

/**
 * D14's attribution rule (PRD §6).
 *
 * *A booking is AI-attributed only if it originates in a concierge session and
 * no engine session preceded it within 24h. Disputes resolve in the owner's
 * favour.*
 *
 * This decides whether a property is billed at 2–4% or at 8–12%, so the tests
 * come in pairs: for each case that must be attributed, the smallest adjacent
 * case that must **not** be. A suite that only asserted the attributed side
 * would be satisfied by a rule that attributes everything — which is the rule
 * that happens to make us the most money, and therefore the one that most needs
 * a test pointing the other way.
 */

const bookedAt = new Date('2026-09-10T14:00:00Z')

const at = (hoursBefore: number): Date => new Date(bookedAt.getTime() - hoursBefore * 3_600_000)

const touch = (
  sessionId: string,
  channel: WindowTouch['channel'],
  hoursBefore: number,
): WindowTouch => ({ sessionId, channel, occurredAt: at(hoursBefore) })

const decide = (
  touches: WindowTouch[],
  conciergeSessionId: string | null = 'c1',
  engineSessionId: string | null = null,
) => decideAttribution({ bookedAt, touches, conciergeSessionId, engineSessionId })

describe('the window', () => {
  it('is 24 hours, from D14', () => {
    // Not a tunable. A property billed under a window we quietly widened would
    // be billed under a rule they never agreed to.
    expect(ATTRIBUTION_WINDOW_HOURS).toBe(24)
  })
})

describe('attributed to the concierge', () => {
  it('attributes a concierge booking with nothing before it', () => {
    const verdict = decide([touch('c1', 'concierge_chat', 1)])

    expect(verdict.kind).toBe('ai_attributed')
  })

  it('attributes when the engine touch came *after* the conversation started', () => {
    /*
     * The case the rule's wording does not settle and the money does.
     *
     * A guest opens the chat, the concierge sends them a link, and they finish
     * on the booking engine. The engine touch is before the *booking* and after
     * the *conversation* — and the conversation is plainly what produced it.
     * Comparing against the booking timestamp would call this direct.
     */
    const verdict = decide([touch('c1', 'concierge_chat', 3), touch('c1', 'engine', 1)])

    expect(verdict.kind).toBe('ai_attributed')
  })

  it('ignores another guest browsing the booking engine first', () => {
    /*
     * The bug the database suite caught, pinned here.
     *
     * The first implementation compared against *every* engine touch the
     * property saw in the window, so one unrelated guest browsing at 10:00
     * disqualified a conversation at 11:00. At a property taking a few bookings
     * a day nothing would ever be attributed — cheap for the owner, and it makes
     * the whole AI-attributed line meaningless.
     *
     * D14 says "no engine session preceded **it**", and `it` is the booking.
     */
    const verdict = decide([touch('someone-else', 'engine', 5), touch('c1', 'concierge_chat', 2)])

    expect(verdict.kind).toBe('ai_attributed')
  })

  it('attributes when the guest own engine session is older than the window', () => {
    // Browsed a week ago in the same browser, booked by chat today. D14 says 24
    // hours, so a touch outside it does not disqualify anything.
    const verdict = decide([touch('c1', 'engine', 26), touch('c1', 'concierge_chat', 2)])

    expect(verdict.kind).toBe('ai_attributed')
  })

  it('attributes a voice session the same way as a chat one', () => {
    const verdict = decide([touch('c1', 'concierge_voice', 1)])

    expect(verdict.kind).toBe('ai_attributed')
  })
})

describe('falls back to the direct rate', () => {
  it('when the guest own engine session preceded the conversation', () => {
    /*
     * The realistic disqualifying case, and the one D14 is aimed at: the guest
     * opened the booking engine, got stuck, and opened the chat from that page
     * in the same browser session. They were already booking.
     */
    const verdict = decide([touch('c1', 'engine', 5), touch('c1', 'concierge_chat', 2)])

    expect(verdict.kind).toBe('direct_booking')
  })

  it('when the reservation carries a separate engine session that came first', () => {
    // A different browser session, but recorded on the booking itself — so it
    // belongs to this booking whatever the session string says.
    const verdict = decide(
      [touch('e-own', 'engine', 5), touch('c1', 'concierge_chat', 2)],
      'c1',
      'e-own',
    )

    expect(verdict.kind).toBe('direct_booking')
  })

  it('when the engine touch is just inside the window', () => {
    // 23 hours 59 minutes disqualifies; the previous test's 26 hours does not.
    const verdict = decideAttribution({
      bookedAt,
      touches: [
        { sessionId: 'c1', channel: 'engine', occurredAt: at(23.9) },
        { sessionId: 'c1', channel: 'concierge_chat', occurredAt: at(2) },
      ],
      conciergeSessionId: 'c1',
    })

    expect(verdict.kind).toBe('direct_booking')
  })

  it('when the reservation names no concierge session', () => {
    const verdict = decide([touch('e1', 'engine', 1)], null)

    expect(verdict.kind).toBe('direct_booking')
  })

  it('when the named concierge session has no touch we can find', () => {
    /*
     * The reservation says a conversation produced it and this table has no
     * record of one — a lost write, or a touch predating the table.
     *
     * Not an error, and emphatically not something to bill the higher rate on.
     * Every ambiguous case resolves to the cheaper fee, which is what D14 means
     * by disputes resolving in the owner's favour.
     */
    const verdict = decide([touch('e1', 'engine', 1)], 'c-missing')

    expect(verdict.kind).toBe('direct_booking')
    expect(String(verdict.evidence.reason)).toContain('no touch in the window')
  })

  it('when there are no touches at all', () => {
    expect(decide([], null).kind).toBe('direct_booking')
    expect(decide([], 'c1').kind).toBe('direct_booking')
  })
})

describe('the evidence chain', () => {
  it('names the rule and the window on every verdict', () => {
    for (const verdict of [decide([touch('c1', 'concierge_chat', 1)]), decide([], null)]) {
      expect(verdict.evidence.rule).toBe('d14-v1')
      expect(verdict.evidence.windowHours).toBe(24)
      expect(verdict.evidence.bookedAt).toBe(bookedAt.toISOString())
    }
  })

  it('names the sessions that disqualified an attribution', () => {
    // An owner disputing the *absence* of an attributed line is as entitled to
    // an answer as one disputing its presence.
    const verdict = decide([touch('c1', 'engine', 5), touch('c1', 'concierge_chat', 2)])

    expect(verdict.evidence.precededBy).toEqual([
      { sessionId: 'c1', occurredAt: at(5).toISOString() },
    ])
  })

  it('records engine touches that did not disqualify it', () => {
    /*
     * The inconvenient number, stored deliberately.
     *
     * This booking is attributed *and* the guest touched the engine after the
     * conversation started. That is the first thing anybody disputing the line
     * will ask about, and an evidence chain that omitted it is one nobody would
     * believe the rest of.
     */
    const verdict = decide([touch('c1', 'concierge_chat', 3), touch('c1', 'engine', 1)])

    expect(verdict.kind).toBe('ai_attributed')
    expect(verdict.evidence.engineTouchesInWindow).toBe(1)
  })

  it('records when the conversation started, not just that it did', () => {
    const verdict = decide([touch('c1', 'concierge_chat', 6), touch('c1', 'concierge_chat', 2)])

    // The earliest touch of that session, so the comparison the rule made is
    // reproducible from the stored chain alone.
    expect(verdict.evidence.conciergeStartedAt).toBe(at(6).toISOString())
  })
})

describe('touches outside the window are ignored entirely', () => {
  it('does not count a touch after the booking', () => {
    // Clock skew, or a session that carried on after the guest booked. Neither
    // is evidence about what produced the booking.
    const verdict = decideAttribution({
      bookedAt,
      touches: [
        { sessionId: 'c1', channel: 'engine', occurredAt: new Date(bookedAt.getTime() + 60_000) },
        { sessionId: 'c1', channel: 'concierge_chat', occurredAt: at(1) },
      ],
      conciergeSessionId: 'c1',
    })

    expect(verdict.kind).toBe('ai_attributed')
    expect(verdict.evidence.engineTouchesInWindow).toBe(0)
  })
})
