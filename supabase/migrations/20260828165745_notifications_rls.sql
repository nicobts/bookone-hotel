-- RLS for the guest communication outbox.
--
-- Ships with the migration that creates the table (binding rule 9). A table
-- created in one change and policed in the next is a table that leaks for
-- however long the second change takes to arrive.
--
-- This one holds guest email addresses and the contents of what was sent to
-- them. It is the most directly personal table in the schema so far, and the
-- policy is correspondingly narrow.

alter table public.notifications enable row level security;

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
-- Read-only from a session, scoped to the property.
--
-- Owners and staff need it: "the guest says they never got the confirmation" is
-- a real front-desk question and this table is the only thing that answers it.
-- E1.2 also measures confirmation latency from these rows, and a measurement
-- the property cannot see is a measurement they cannot trust.
--
-- No insert, update or delete policy, deliberately:
--
--   * insert belongs to the transaction that commits the thing being announced.
--     A person inserting a notification row would be asserting that a message
--     was queued when none was.
--   * update belongs to the sender. `status`, `attempts`, `provider_message_id`
--     and `sent_at` are a record of what a provider actually did; a hand-edited
--     delivery record is worse than no record, because it looks like evidence.
--   * delete would remove the audit trail for a message that has already
--     reached a human being. Retention is the E8 job's decision, applied by
--     policy on a schedule, not a button next to a row.
--
-- All four of those paths run under the service role in the worker, which still
-- scopes every query by property_id explicitly (ADR-007, binding rule 3).

create policy notifications_select on public.notifications
  for select to authenticated
  using (property_id in (select public.user_property_ids()));
