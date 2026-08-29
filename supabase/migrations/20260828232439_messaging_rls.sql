-- RLS for the knowledge base, messaging, tasks and departure (E3.2–E4.1).
--
-- Ships with the migration that creates the tables (binding rule 9). A table
-- created in one change and policed in the next is a table that leaks for
-- however long the second change takes to arrive.
--
-- Six tables, three different shapes of answer:
--
--   * `kb_articles` is the property's own content, and staff edit it.
--   * `message_threads` and `messages` are a conversation with a guest — read
--     and appended by staff, but never rewritten by anyone.
--   * `stay_tasks`, `stay_extras` and `invoice_requests` are operational rows
--     with one hard line through them: nothing here touches the fiscal chain.
--
-- The guest's own access to their thread is not an `authenticated` session at
-- all. It is a signed stay token, resolved server-side, and every query on that
-- path runs under the service role scoped explicitly by property and
-- reservation (ADR-007, ADR-018). There is deliberately no `anon` policy on any
-- of these tables: a guest who can read one thread must not be one predicate
-- away from reading every thread in the property.

alter table public.kb_articles enable row level security;
alter table public.message_threads enable row level security;
alter table public.messages enable row level security;
alter table public.stay_tasks enable row level security;
alter table public.stay_extras enable row level security;
alter table public.invoice_requests enable row level security;

-- ---------------------------------------------------------------------------
-- kb_articles
-- ---------------------------------------------------------------------------
-- The property's answers to its own guests' questions, and therefore the whole
-- of what the concierge is permitted to say (binding rule 7). Members read and
-- write it: an owner who cannot correct a wrong breakfast time without opening
-- a support ticket will let the concierge keep saying the wrong time.
--
-- Insert and update are open to staff as well as owners, matching `guests` and
-- unlike `room_types`. The distinction the original policy set drew is between
-- *administering* a property and *operating* it, and correcting the wifi
-- password is operating it. A seasonal receptionist who notices the answer is
-- stale should be able to fix it.
--
-- No delete. An article the concierge has already quoted is evidence of what a
-- guest was told; unpublishing it (`published = false`) takes it out of service
-- without erasing what it said.

create policy kb_articles_select on public.kb_articles
  for select to authenticated
  using (property_id in (select public.user_property_ids()));

create policy kb_articles_insert on public.kb_articles
  for insert to authenticated
  with check (property_id in (select public.user_property_ids()));

create policy kb_articles_update on public.kb_articles
  for update to authenticated
  using (property_id in (select public.user_property_ids()))
  with check (property_id in (select public.user_property_ids()));

-- ---------------------------------------------------------------------------
-- message_threads
-- ---------------------------------------------------------------------------
-- Members read every thread in their property and may update one: taking it
-- over, handing it back, closing it. That is the whole of E3.3's one-tap
-- takeover, and it is a session write rather than a worker call because the
-- person doing it is looking at the thread when they decide.
--
-- No insert: a thread is opened by the guest writing, inside the transaction
-- that stores their first message. A staff-created empty thread would be a
-- conversation the guest has never seen, sitting in the queue, waiting for a
-- reply to nothing.
--
-- No delete: deleting a thread destroys what a guest was told, which is exactly
-- the record that matters when they say they were told something else.

create policy message_threads_select on public.message_threads
  for select to authenticated
  using (property_id in (select public.user_property_ids()));

create policy message_threads_update on public.message_threads
  for update to authenticated
  using (property_id in (select public.user_property_ids()))
  with check (property_id in (select public.user_property_ids()));

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
-- Read and append. Nothing else, and the "nothing else" is the point.
--
-- The insert policy carries a second predicate beyond the property scope:
-- `author = 'staff'`. A session may only write a message *as itself*. Without
-- it, a member of staff could insert a row labelled `agent` — which the
-- tool-boundary audit reads as an agent's output, and which an owner reviewing
-- a thread would read as something the software said rather than something a
-- person said. The database is where that stays true, because it is the only
-- place both write paths meet.
--
-- No update and no delete, on purpose and with no exception for typos. A
-- message a guest has already read is a record of what they were told; a
-- correction is a new message, which is also how it works when a person says
-- the wrong thing out loud at a desk.

create policy messages_select on public.messages
  for select to authenticated
  using (property_id in (select public.user_property_ids()));

create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    property_id in (select public.user_property_ids())
    and author = 'staff'
    and author_user_id = (select auth.uid())
  );

-- ---------------------------------------------------------------------------
-- stay_tasks
-- ---------------------------------------------------------------------------
-- The one table on this list a person genuinely works in: a member of staff
-- adds a task, ticks it off, or cancels it. Insert, update, no delete —
-- cancelling records that somebody decided not to do it, which is information;
-- deleting the row makes it look as though nobody ever asked.

create policy stay_tasks_select on public.stay_tasks
  for select to authenticated
  using (property_id in (select public.user_property_ids()));

create policy stay_tasks_insert on public.stay_tasks
  for insert to authenticated
  with check (property_id in (select public.user_property_ids()));

create policy stay_tasks_update on public.stay_tasks
  for update to authenticated
  using (property_id in (select public.user_property_ids()))
  with check (property_id in (select public.user_property_ids()));

-- ---------------------------------------------------------------------------
-- stay_extras
-- ---------------------------------------------------------------------------
-- Read-only from a session.
--
-- A `platform` row is something we registered and will settle; a `pms` row is
-- read-through from the property's own system and is not ours to touch. Neither
-- is a thing a person should be able to type into a table directly: an extra
-- created by hand is an amount a guest will be asked to pay that no command
-- produced and no event records.
--
-- Adding an extra is a domain command in the worker, which emits its event.
-- When the console gains a "charge this to the room" button, that button calls
-- the command — it does not gain an insert policy here.

create policy stay_extras_select on public.stay_extras
  for select to authenticated
  using (property_id in (select public.user_property_ids()));

-- ---------------------------------------------------------------------------
-- invoice_requests
-- ---------------------------------------------------------------------------
-- Read-only from a session, and read-only for a reason worth stating plainly:
-- this row is a *request* a guest made, not a document anyone issued. We assign
-- no number, generate nothing, and transmit nothing to any authority (D11,
-- binding rule 6). The property issues the fattura through its own certified
-- chain, and the only thing we owe them is the guest's words, unaltered.
--
-- No update, therefore. Editing what a guest asked for and then routing it as
-- though they had asked for that is the failure mode this forecloses. A guest
-- who wants different details makes a new request, which replaces theirs.
--
-- `routed_at` is stamped by the worker when the request reaches the property.

create policy invoice_requests_select on public.invoice_requests
  for select to authenticated
  using (property_id in (select public.user_property_ids()));
