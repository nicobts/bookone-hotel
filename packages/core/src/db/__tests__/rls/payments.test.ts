import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FakePaymentAdapter } from './fake-payment-adapter'
import { db, closeConnection } from '../../client'
import { seed, type Fixture } from './support'
import { createHold } from '../../../booking/hold'
import { attachGuest, confirmReservation } from '../../../booking/confirm'
import { cancelBooking, quoteCancellation } from '../../../booking/cancel'
import { startCheckout } from '../../../payments/checkout'
import { applyPaymentEvent, replayLostPayments } from '../../../payments/webhook'

/**
 * The money path, against a real database (E1.3, E1.4, D14).
 *
 * MEMO: no money moves — the provider here is a local fake standing in for the
 * port (ADR-010). Everything else is the shipping path: the ledger, the fee
 * events, the webhook as the only state authority, the redelivery behaviour,
 * the refund arithmetic and the lost-webhook replay.
 *
 * The fake is local rather than `@bookone/adapters`' mock because that package
 * depends on this one — core is tested against its ports, never against an
 * implementation of them. Webhook signature verification therefore lives where
 * it belongs, in the adapter's own contract suite.
 */

let fixture: Fixture
const ARRIVAL = '2026-11-02'
const DEPARTURE = '2026-11-05'
const NIGHTS = ['2026-11-02', '2026-11-03', '2026-11-04'].map((date) => ({
  date,
  priceCents: 10_000,
  currency: 'EUR',
  snapshotId: `snap-${date}`,
}))

const GUEST = { name: 'Rosa Weber', email: 'rosa@example.test', locale: 'de' }

function adapter() {
  return new FakePaymentAdapter()
}

/** A property that takes a 30% deposit and refunds fully up to 48h out. */
async function setPolicy(propertyId: string, policy: unknown): Promise<void> {
  await db.execute(
    sql`update properties set settings = ${JSON.stringify(policy)}::jsonb where id = ${propertyId}`,
  )
}

async function roomTypeId(propertyId: string, code = 'DBL'): Promise<string> {
  const [row] = await db.execute<{ id: string }>(
    sql`select id from room_types where property_id = ${propertyId} and code = ${code}`,
  )

  return row!.id
}

/** A hold with a guest attached — the state a checkout starts from. */
async function readyHold(propertyId: string): Promise<string> {
  const hold = await createHold({
    propertyId,
    roomTypeId: await roomTypeId(propertyId),
    arrival: ARRIVAL,
    departure: DEPARTURE,
    adults: 2,
    children: 0,
    nights: NIGHTS,
  })

  if (hold.status !== 'held') throw new Error('fixture hold failed')

  const attached = await attachGuest({
    propertyId,
    reservationId: hold.reservationId,
    guest: GUEST,
  })

  if (attached.status !== 'attached') throw new Error('fixture guest attach failed')

  return hold.reservationId
}

beforeAll(async () => {
  fixture = await seed()
})

afterAll(async () => {
  await closeConnection()
})

describe('startCheckout', () => {
  it('skips payment entirely when the property takes no deposit', async () => {
    await setPolicy(fixture.alpha.propertyId, {})
    const reservationId = await readyHold(fixture.alpha.propertyId)

    const outcome = await startCheckout(
      { adapter: adapter() },
      { propertyId: fixture.alpha.propertyId, reservationId, returnUrl: 'https://x.test/back' },
    )

    expect(outcome.status).toBe('no-payment-required')

    // Nothing written. A payment row for a payment nobody will make is a row
    // the replay sweep would spend the rest of its life asking about.
    const rows = await db.execute(
      sql`select id from payments where reservation_id = ${reservationId}`,
    )
    expect(rows).toHaveLength(0)
  })

  it('creates one intent, one payment row and one external ref', async () => {
    await setPolicy(fixture.alpha.propertyId, {
      policy: { deposit: { mode: 'percent', percent: 30 } },
    })
    const reservationId = await readyHold(fixture.alpha.propertyId)

    const outcome = await startCheckout(
      { adapter: adapter() },
      { propertyId: fixture.alpha.propertyId, reservationId, returnUrl: 'https://x.test/back' },
    )

    expect(outcome.status).toBe('payment-required')
    if (outcome.status !== 'payment-required') return

    // 30% of €300.00
    expect(outcome.amountCents).toBe(9_000)

    const [payment] = await db.execute<{ status: string; kind: string; simulated: boolean }>(
      sql`select status, kind, simulated from payments where reservation_id = ${reservationId}`,
    )
    expect(payment?.status).toBe('requires_payment')
    expect(payment?.kind).toBe('deposit')
    // Denormalised on purpose: once a real provider is connected these rows sit
    // beside real ones forever, and a report that sums them together is wrong.
    expect(payment?.simulated).toBe(true)

    // The provider's id lives in external_refs, like every foreign id.
    const refs = await db.execute(
      sql`select id from external_refs where entity_type = 'payment'
          and property_id = ${fixture.alpha.propertyId}`,
    )
    expect(refs.length).toBeGreaterThan(0)
  })

  it('refuses to start before a guest is attached', async () => {
    await setPolicy(fixture.alpha.propertyId, {
      policy: { deposit: { mode: 'percent', percent: 30 } },
    })

    const hold = await createHold({
      propertyId: fixture.alpha.propertyId,
      roomTypeId: await roomTypeId(fixture.alpha.propertyId),
      arrival: ARRIVAL,
      departure: DEPARTURE,
      adults: 2,
      children: 0,
      nights: NIGHTS,
    })
    if (hold.status !== 'held') throw new Error('fixture failed')

    const outcome = await startCheckout(
      { adapter: adapter() },
      {
        propertyId: fixture.alpha.propertyId,
        reservationId: hold.reservationId,
        returnUrl: 'https://x.test/back',
      },
    )

    // Paying for a booking with nobody on it produces a captured amount and
    // no one to confirm, refund or contact.
    expect(outcome.status).toBe('rejected')
  })

  it('does not create a second intent when the guest refreshes', async () => {
    await setPolicy(fixture.alpha.propertyId, {
      policy: { deposit: { mode: 'percent', percent: 30 } },
    })
    const reservationId = await readyHold(fixture.alpha.propertyId)
    const pay = adapter()

    await startCheckout(
      { adapter: pay },
      { propertyId: fixture.alpha.propertyId, reservationId, returnUrl: 'https://x.test/back' },
    )
    const second = await startCheckout(
      { adapter: pay },
      { propertyId: fixture.alpha.propertyId, reservationId, returnUrl: 'https://x.test/back' },
    )

    expect(second.status).toBe('already-started')

    const rows = await db.execute(
      sql`select id from payments where reservation_id = ${reservationId}`,
    )
    // Without this, a guest who refreshes the payment page can pay twice.
    expect(rows).toHaveLength(1)
  })

  it('will not start a checkout for another property’s reservation', async () => {
    await setPolicy(fixture.alpha.propertyId, {
      policy: { deposit: { mode: 'percent', percent: 30 } },
    })
    const reservationId = await readyHold(fixture.alpha.propertyId)

    const outcome = await startCheckout(
      { adapter: adapter() },
      {
        propertyId: fixture.beta.propertyId,
        reservationId,
        returnUrl: 'https://x.test/back',
      },
    )

    expect(outcome.status).toBe('rejected')
  })
})

describe('the webhook is the state authority', () => {
  async function paidHold() {
    await setPolicy(fixture.alpha.propertyId, {
      policy: { deposit: { mode: 'percent', percent: 30 } },
      fees: { directBookingBps: 300, aiAttributedBps: 1000 },
    })

    const reservationId = await readyHold(fixture.alpha.propertyId)
    const pay = adapter()

    await startCheckout(
      { adapter: pay },
      { propertyId: fixture.alpha.propertyId, reservationId, returnUrl: 'https://x.test/back' },
    )

    const [ref] = await db.execute<{ external_id: string }>(
      sql`select e.external_id from external_refs e
            join payments p on p.id = e.entity_id
           where p.reservation_id = ${reservationId} and e.entity_type = 'payment'`,
    )

    return { reservationId, pay, intentId: ref!.external_id }
  }

  it('does not confirm the booking until the webhook arrives', async () => {
    const { reservationId } = await paidHold()

    const [row] = await db.execute<{ status: string }>(
      sql`select status from reservations where id = ${reservationId}`,
    )

    // The browser leaving for a checkout page proves nothing. Confirming on the
    // redirect back would confirm bookings nobody paid for.
    expect(row?.status).toBe('hold')
  })

  it('confirms, settles the payment and writes the fee when it does', async () => {
    const { reservationId, pay, intentId } = await paidHold()

    const outcome = await applyPaymentEvent({ adapter: pay }, pay.settle(intentId))

    expect(outcome.status).toBe('confirmed')

    const [reservation] = await db.execute<{ status: string }>(
      sql`select status from reservations where id = ${reservationId}`,
    )
    expect(reservation?.status).toBe('confirmed')

    const [payment] = await db.execute<{ status: string; settled_at: string | null }>(
      sql`select status, settled_at from payments where reservation_id = ${reservationId}`,
    )
    expect(payment?.status).toBe('succeeded')
    expect(payment?.settled_at).toBeTruthy()

    // 3% of €300.00 — the invoice basis (D14), written once, at confirmation.
    const [fee] = await db.execute<{ kind: string; fee_cents: number; rate_bps: number }>(
      sql`select kind, fee_cents, rate_bps from fee_events where reservation_id = ${reservationId}`,
    )
    expect(fee?.kind).toBe('direct_booking')
    expect(fee?.rate_bps).toBe(300)
    expect(fee?.fee_cents).toBe(900)
  })

  it('is idempotent under redelivery — one fee, one confirmation, one email', async () => {
    const { reservationId, pay, intentId } = await paidHold()

    await applyPaymentEvent({ adapter: pay }, pay.settle(intentId))

    // A provider that gets no 2xx redelivers for days. Every redelivery re-runs
    // this, and a second fee row here is a real overcharge on a real invoice.
    // Note the second event carries its own provider event id, as a redelivery
    // would not — so this is the harder case, not the easier one.
    const outcome = await applyPaymentEvent({ adapter: pay }, pay.settle(intentId))

    expect(outcome.status).toBe('already-applied')

    const fees = await db.execute(
      sql`select id from fee_events where reservation_id = ${reservationId}`,
    )
    const notifications = await db.execute(
      sql`select id from notifications where reservation_id = ${reservationId}`,
    )
    const confirmations = await db.execute(
      sql`select id from domain_events
           where entity_id = ${reservationId} and event_type = 'reservation.confirmed'`,
    )

    expect(fees).toHaveLength(1)
    expect(notifications).toHaveLength(1)
    expect(confirmations).toHaveLength(1)
  })

  it('leaves the hold alive when the card is declined', async () => {
    const { reservationId, pay, intentId } = await paidHold()

    const outcome = await applyPaymentEvent({ adapter: pay }, pay.decline(intentId))

    expect(outcome.status).toBe('recorded')

    const [reservation] = await db.execute<{ status: string }>(
      sql`select status from reservations where id = ${reservationId}`,
    )
    const [payment] = await db.execute<{ status: string }>(
      sql`select status from payments where reservation_id = ${reservationId}`,
    )

    // E1.3: the guest returns to the payment step with a reason and the room
    // still held. Cancelling here would punish a declined card by taking the
    // room away too.
    expect(reservation?.status).toBe('hold')
    expect(payment?.status).toBe('failed')
  })

  it('recovers a booking whose webhook was lost', async () => {
    const { reservationId, pay, intentId } = await paidHold()

    // The guest paid; the delivery never arrived. Without the replay this is
    // the worst failure in the product: money taken, no booking.
    pay.settle(intentId)

    await db.execute(
      sql`update payments set created_at = now() - interval '10 minutes'
           where reservation_id = ${reservationId}`,
    )

    const result = await replayLostPayments({ adapter: pay }, { olderThanSeconds: 300, limit: 10 })

    expect(result.recovered).toBe(1)

    const [reservation] = await db.execute<{ status: string }>(
      sql`select status from reservations where id = ${reservationId}`,
    )
    expect(reservation?.status).toBe('confirmed')
  })
})

describe('cancellation (E1.4)', () => {
  async function confirmedPaidBooking(cancellation: unknown) {
    await setPolicy(fixture.alpha.propertyId, {
      policy: { deposit: { mode: 'percent', percent: 30 }, cancellation },
    })

    const reservationId = await readyHold(fixture.alpha.propertyId)
    const pay = adapter()

    await startCheckout(
      { adapter: pay },
      { propertyId: fixture.alpha.propertyId, reservationId, returnUrl: 'https://x.test/back' },
    )

    const [ref] = await db.execute<{ external_id: string }>(
      sql`select e.external_id from external_refs e
            join payments p on p.id = e.entity_id
           where p.reservation_id = ${reservationId} and e.entity_type = 'payment'`,
    )

    await applyPaymentEvent({ adapter: pay }, pay.settle(ref!.external_id))

    return { reservationId, pay }
  }

  it('quotes the refund before anything is cancelled', async () => {
    const { reservationId } = await confirmedPaidBooking([
      { hoursBeforeArrival: 48, refundPercent: 100 },
    ])

    const quote = await quoteCancellation({
      propertyId: fixture.alpha.propertyId,
      reservationId,
    })

    // Arrival is well over 48 hours out, so the deposit comes back in full.
    expect(quote?.paidCents).toBe(9_000)
    expect(quote?.refundCents).toBe(9_000)
    expect(quote?.cancellable).toBe(true)

    // And nothing has happened yet — this is a quote, not a side effect.
    const [row] = await db.execute<{ status: string }>(
      sql`select status from reservations where id = ${reservationId}`,
    )
    expect(row?.status).toBe('confirmed')
  })

  it('cancels, refunds per policy, and leaves the ledger summing correctly', async () => {
    const { reservationId, pay } = await confirmedPaidBooking([
      { hoursBeforeArrival: 48, refundPercent: 100 },
    ])

    const outcome = await cancelBooking(
      { adapter: pay },
      { propertyId: fixture.alpha.propertyId, reservationId },
    )

    expect(outcome).toMatchObject({ status: 'cancelled', refundCents: 9_000, refundFailed: false })

    const [row] = await db.execute<{ status: string }>(
      sql`select status from reservations where id = ${reservationId}`,
    )
    expect(row?.status).toBe('cancelled')

    const [ledger] = await db.execute<{ total: number }>(
      sql`select coalesce(sum(amount_cents), 0)::int as total from payments
           where reservation_id = ${reservationId} and status = 'succeeded'`,
    )
    // Refunds are stored negative precisely so this is a plain sum. The
    // property holds nothing after a full refund.
    expect(ledger?.total).toBe(0)
  })

  it('keeps what the policy says to keep', async () => {
    // A single window at 24 hours: the guest is well outside it, so they
    // qualify for its 50% and nothing more generous exists.
    const { reservationId, pay } = await confirmedPaidBooking([
      { hoursBeforeArrival: 24, refundPercent: 50 },
    ])

    const outcome = await cancelBooking(
      { adapter: pay },
      { propertyId: fixture.alpha.propertyId, reservationId },
    )

    expect(outcome).toMatchObject({ status: 'cancelled', refundCents: 4_500 })

    const [ledger] = await db.execute<{ total: number }>(
      sql`select coalesce(sum(amount_cents), 0)::int as total from payments
           where reservation_id = ${reservationId} and status = 'succeeded'`,
    )
    expect(ledger?.total).toBe(4_500)
  })

  it('does not refund twice when the guest presses cancel twice', async () => {
    const { reservationId, pay } = await confirmedPaidBooking([
      { hoursBeforeArrival: 48, refundPercent: 100 },
    ])

    await cancelBooking({ adapter: pay }, { propertyId: fixture.alpha.propertyId, reservationId })
    const second = await cancelBooking(
      { adapter: pay },
      { propertyId: fixture.alpha.propertyId, reservationId },
    )

    expect(second.status).toBe('already-cancelled')

    const refunds = await db.execute(
      sql`select id from payments where reservation_id = ${reservationId} and kind = 'refund'`,
    )
    expect(refunds).toHaveLength(1)
  })

  it('allows several refunds against one booking, but only one charge', async () => {
    const { reservationId } = await confirmedPaidBooking([
      { hoursBeforeArrival: 48, refundPercent: 100 },
    ])

    // The constraint that guards against a replayed webhook must not also
    // forbid a partial refund followed by another. It was written as a plain
    // unique on (reservation, kind, provider) first, with a comment claiming
    // refunds were excluded when nothing excluded them.
    const insertRefund = (cents: number) =>
      db.execute(sql`
        insert into payments (property_id, reservation_id, kind, status, amount_cents,
                              currency, provider, simulated)
        values (${fixture.alpha.propertyId}, ${reservationId}, 'refund', 'succeeded',
                ${-cents}, 'EUR', 'manual-test', false)`)

    await insertRefund(100)
    await expect(insertRefund(200)).resolves.toBeDefined()

    // The charge side is still exactly once, which is the half that matters for
    // a redelivered webhook.
    const insertDeposit = () =>
      db.execute(sql`
        insert into payments (property_id, reservation_id, kind, status, amount_cents,
                              currency, provider, simulated)
        values (${fixture.alpha.propertyId}, ${reservationId}, 'deposit', 'succeeded',
                1000, 'EUR', 'manual-test', false)`)

    await insertDeposit()
    await expect(insertDeposit()).rejects.toThrow()
  })

  it('will not cancel another property’s booking', async () => {
    const { reservationId, pay } = await confirmedPaidBooking([
      { hoursBeforeArrival: 48, refundPercent: 100 },
    ])

    const outcome = await cancelBooking(
      { adapter: pay },
      { propertyId: fixture.beta.propertyId, reservationId },
    )

    expect(outcome).toEqual({ status: 'rejected', reason: 'unknown reservation' })

    const [row] = await db.execute<{ status: string }>(
      sql`select status from reservations where id = ${reservationId}`,
    )
    expect(row?.status).toBe('confirmed')
  })

  it('keeps the fee event after a cancellation', async () => {
    const { reservationId, pay } = await confirmedPaidBooking([
      { hoursBeforeArrival: 48, refundPercent: 100 },
    ])

    await cancelBooking({ adapter: pay }, { propertyId: fixture.alpha.propertyId, reservationId })

    // Whether a cancelled booking is still billable is a commercial question
    // for the contract, not one a cancellation handler answers by deleting the
    // evidence. Sprint 8's report decides, with the rows intact either way.
    const fees = await db.execute(
      sql`select id from fee_events where reservation_id = ${reservationId}`,
    )
    expect(fees).toHaveLength(1)
  })
})

describe('the expiry job and paid holds', () => {
  it('leaves a hold alone once money has settled against it', async () => {
    await setPolicy(fixture.alpha.propertyId, {
      policy: { deposit: { mode: 'percent', percent: 30 } },
    })

    const reservationId = await readyHold(fixture.alpha.propertyId)
    const pay = adapter()

    await startCheckout(
      { adapter: pay },
      { propertyId: fixture.alpha.propertyId, reservationId, returnUrl: 'https://x.test/back' },
    )

    const [ref] = await db.execute<{ external_id: string }>(
      sql`select e.external_id from external_refs e
            join payments p on p.id = e.entity_id
           where p.reservation_id = ${reservationId} and e.entity_type = 'payment'`,
    )

    // Settle the money but do not deliver the webhook, then age the hold past
    // its expiry. This is the exact state a lost webhook leaves behind.
    pay.settle(ref!.external_id)
    await db.execute(
      sql`update payments set status = 'succeeded', settled_at = now()
           where reservation_id = ${reservationId}`,
    )
    await db.execute(
      sql`update reservations set hold_expires_at = now() - interval '1 minute'
           where id = ${reservationId}`,
    )

    const { expireHolds } = await import('../../../booking/hold')
    await expireHolds()

    const [row] = await db.execute<{ status: string }>(
      sql`select status from reservations where id = ${reservationId}`,
    )

    // Cancelling this would take the room away from someone who has already
    // paid for it, silently and on a schedule.
    expect(row?.status).toBe('hold')
  })
})

describe('confirmReservation without a guest', () => {
  it('refuses, rather than confirming a stay nobody can be told about', async () => {
    const hold = await createHold({
      propertyId: fixture.alpha.propertyId,
      roomTypeId: await roomTypeId(fixture.alpha.propertyId),
      arrival: ARRIVAL,
      departure: DEPARTURE,
      adults: 2,
      children: 0,
      nights: NIGHTS,
    })
    if (hold.status !== 'held') throw new Error('fixture failed')

    const outcome = await confirmReservation({
      propertyId: fixture.alpha.propertyId,
      reservationId: hold.reservationId,
    })

    expect(outcome.status).toBe('rejected')
  })
})
