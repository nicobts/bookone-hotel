-- RLS for the journey tables, and the private bucket their documents live in.
--
-- Ships with the migration that creates them (binding rule 9).
--
-- `registration_records` is the most sensitive table in the schema so far. It
-- holds identity-document details for people who are not our users and never
-- agreed to anything with us — they are travelling companions of somebody who
-- booked. The policies below are written with that in mind.

alter table public.journey_states       enable row level security;
alter table public.registration_records enable row level security;

-- ---------------------------------------------------------------------------
-- journey_states
-- ---------------------------------------------------------------------------
-- Read-only from a session, scoped to the property.
--
-- The console reads it constantly: Today is a list of arrivals and how far
-- along each one is, and the exceptions inbox will read it for stays that are
-- stuck. Realtime projects it to the console (ADR-013), which is a read.
--
-- **No write policy at all, and this one is load-bearing.** Binding rule 4 says
-- journey state changes only via evented commands. A staff member who could
-- update this table directly could mark a stay arrived without the transition
-- that fires Alloggiati, sends the welcome message and records who did it —
-- and the zero-touch metric (G1) is computed from those events, so a state
-- reached without one is a state that never happened as far as the product can
-- tell.
--
-- The console's arrival button therefore goes through the same command every
-- other trigger source does, under the service role, with an actor recorded.

create policy journey_states_select on public.journey_states
  for select to authenticated
  using (property_id in (select public.user_property_ids()));

-- ---------------------------------------------------------------------------
-- registration_records
-- ---------------------------------------------------------------------------
-- Members read them: the desk has to check who is arriving, and Alloggiati is
-- the property's legal obligation, not ours (E2.3).
--
-- No insert or update from a session. These rows are written by the guest
-- through the pre-arrival surface, which holds no session at all (ADR-007) and
-- runs under the service role scoped to one reservation by a signed token. A
-- staff member typing a companion's document number into our database is a
-- thing that happens at a desk with paper, not a thing this table accepts.
--
-- No delete either — and note this is a table where deletion is a *feature*
-- (E2.4). Deleting the document is a retention job that nulls `document_path`,
-- stamps `deleted_at` and emits an event; deleting the *row* would destroy the
-- record of the deletion along with the audit trail proving it happened.

create policy registration_records_select on public.registration_records
  for select to authenticated
  using (property_id in (select public.user_property_ids()));

-- ---------------------------------------------------------------------------
-- Identity documents in Storage
-- ---------------------------------------------------------------------------
-- Private bucket. Not "unlisted", not "public with unguessable names" —
-- private, so every read is an authorised read.
--
-- Nothing reaches these objects from a browser. The guest uploads through a
-- server action and the console views through a short-lived signed URL, both
-- minted server-side. That is why there is no storage policy granting the
-- `authenticated` role anything: the only client with access is the service
-- role, inside our own process.
--
-- EU residency (D9): this is the same Supabase project as everything else, in
-- Frankfurt. A photograph of a passport is exactly the data that must not leave.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'identity-documents',
  'identity-documents',
  false,
  -- 10 MB. A phone photograph of a passport is 2–5 MB; anything much larger is
  -- a mistake or an attempt, and rejecting it at the edge costs nothing.
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
