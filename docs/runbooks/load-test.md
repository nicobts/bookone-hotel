# Runbook — load test on the booking path

```bash
pnpm tsx scripts/loadtest-booking.mts <slug> <total> <concurrency>
pnpm tsx scripts/loadtest-booking.mts hotel-sonja 1000 60
```

It writes real reservations and refuses to run against a non-local database.
Clean up afterwards — the last section says how.

---

## What it measures, and what it deliberately does not

It drives the **domain** path: `createHold` → `attachGuest` →
`confirmReservation`. Not HTTP.

That is the useful half. The web layer in front of it is stateless and scales
horizontally on Vercel; every interesting failure on this path is in the
database, and a test that spent its time in TLS handshakes would hide all of
them. What it therefore does **not** measure is Vercel cold starts, the
availability query the booking page runs first, or anything about the network —
each of which needs its own instrument.

Three specific things it is looking for:

**Reference collisions.** `generateReference()` draws from a 729-million space
into a column that is unique per property. A collision throws, and the guest
sees a booking that failed for a reason they cannot act on. The unit test
asserts the generator's distribution; this asserts what happens when hundreds of
draws land in the same second.

**The attribution write on the critical path.** Every hold writes an
`attribution_events` row in the same transaction (D14). That is two writes per
booking on the one operation a hotel cannot afford to be slow.

**Where the latency curve bends.** Concurrency past the pool size queues rather
than fails, and the question is where.

## Results — 2026-08-29

Local Docker Postgres, one laptop, mock adapter. **These are a floor and a
shape, not a capacity number** — a managed EU instance is a different machine
and the figure that matters is the one measured on staging.

| Bookings | Concurrency | Succeeded | Throughput | p50 | p95 | p99 |
|---|---|---|---|---|---|---|
| 20 | 5 | 20/20 | 51/s | 81 ms | 148 ms | 148 ms |
| 500 | 25 | 500/500 | 66/s | 314 ms | 753 ms | 1003 ms |
| 1000 | 60 | 1000/1000 | 83/s | 702 ms | 864 ms | 943 ms |

**No failures in 1,520 bookings.** No reference collisions, no pool exhaustion,
no deadlocks between the reservation insert and the attribution write.

Read the shape rather than the numbers. Throughput plateaus around 80/s while
latency rises roughly linearly with concurrency — the signature of a saturated
resource with a fair queue in front of it, which is what a connection pool
against one Postgres is. Nothing is failing under pressure; work is waiting.

For context on whether that matters: a hotel with eighteen rooms takes on the
order of ten direct bookings a day. Eighty per second is four orders of
magnitude above the load a single property produces, and the platform would need
several thousand properties before this path was the constraint. The reason to
measure it anyway is the tail — a p99 of one second at 25 concurrent is fine,
and the same figure at ten times the concurrency would not be.

## What to do when a run fails

**`hold: cannot price the stay`** — the script supplies its own nights, so this
means `quoteStay` rejected them. Not a load problem; read the reason.

**A duplicate-key error on `reservations_property_reference`** — the collision
this test exists to find. It would mean the reference space is too small for the
rate, and the fix is a longer reference, not a retry loop: a retry hides the
frequency, and the frequency is the thing that tells you when it will get worse.

**Rising failures rather than rising latency** past some concurrency — the pool
is rejecting instead of queueing. Check `max` connections on the instance
against the pool size in `db/client.ts` and against however many worker
processes are also connected.

## Cleaning up

The script leaves confirmed reservations, guests, attribution touches and fee
events behind. On a local stack the blunt instrument is fine:

```bash
pnpm db:reset && pnpm db:seed
```

To keep the rest of the local data, delete by the marker the script writes —
`engine_session_id like 'load-%'` — in this order, because `fee_events`,
`payments` and `alloggiati_submissions` are `restrict` on a reservation:

```sql
begin;
create temp table load_ids as
  select id, guest_id from reservations where engine_session_id like 'load-%';
delete from domain_events where entity_id in (select id from load_ids);
delete from fee_events           where reservation_id in (select id from load_ids);
delete from payments             where reservation_id in (select id from load_ids);
delete from alloggiati_submissions where reservation_id in (select id from load_ids);
delete from reservations where id in (select id from load_ids);
delete from guests where id in (select guest_id from load_ids)
   and email like 'load-%@example.invalid';
commit;
```

That deletion order is the same one the retention sweep uses for the ten-year
reservation rule, and for the same reason — the map declares those three tables
as dependents because the database will not remove them for you.

## Still to run

- **On staging, against the EU instance.** The numbers above are a laptop's.
  This is the one that goes in the GA checklist.
- **Through HTTP**, including the availability query the booking page runs
  first. That query reads `rate_snapshots` across a date range and is the more
  likely hot spot in production; this test skips it entirely by supplying its
  own priced nights.
- **With the worker running.** Every confirmation enqueues a reflection and a
  notification. This test measures the write; it does not measure what the queue
  does with fifteen hundred of them.
