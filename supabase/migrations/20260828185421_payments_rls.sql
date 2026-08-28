-- RLS for the money tables.
--
-- Ships with the migration that creates them (binding rule 9).
--
-- Both tables are read-only from a session, and the reasons differ enough to
-- state separately.

alter table public.payments   enable row level security;
alter table public.fee_events enable row level security;

-- ---------------------------------------------------------------------------
-- payments
-- ---------------------------------------------------------------------------
-- Members read their property's movements. The console shows what was taken and
-- what was refunded, and an owner who cannot see that has to ask us.
--
-- No insert, update or delete policy:
--
--   * the provider's webhook is the only state authority (03 §7.2). A row
--     written from a session would assert that money moved when nothing did —
--     and the reconciliation that would eventually catch it runs against the
--     provider, not against us.
--   * a refund is a movement, so it is an insert by the same authority, not an
--     edit of the charge it reverses. That is why there is no update path even
--     for the status column.
--   * delete would erase the record of a real charge to a real person.
--
-- The worker writes these under the service role, still scoping every query by
-- property_id explicitly (ADR-007, binding rule 3).

create policy payments_select on public.payments
  for select to authenticated
  using (property_id in (select public.user_property_ids()));

-- ---------------------------------------------------------------------------
-- fee_events
-- ---------------------------------------------------------------------------
-- The property reads what it will be billed. Not a courtesy: D14 makes the
-- monthly report the invoice basis, and an invoice the payer cannot inspect
-- before it arrives is an invoice they will dispute after.
--
-- Owners *and* staff can read it. The alternative — restricting it to owners —
-- was rejected because these rows are the evidence behind a number the owner
-- will be asked about, and a receptionist who can see the booking but not the
-- fee attached to it cannot answer the question either.
--
-- Nothing writes from a session, ever. A fee is computed once, at confirmation,
-- from the values true at that moment; a hand-written or hand-edited fee row is
-- a line on an invoice nobody can reproduce.

create policy fee_events_select on public.fee_events
  for select to authenticated
  using (property_id in (select public.user_property_ids()));
