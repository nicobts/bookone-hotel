-- Row Level Security — the tenant isolation boundary (ADR-007, binding rule 3).
--
-- This file is security code. Read it as such: everything below is what stands
-- between one hotel's guest list and another's. Route guards in the app are an
-- optimistic convenience; these policies are the actual boundary.
--
-- Hand-written rather than generated, so that every policy is reviewable.
--
-- Ships in the same change as the schema it protects (binding rule 9). A table
-- created in one commit and policed in the next is a table that leaks for
-- however long the second commit takes to arrive.

-- ---------------------------------------------------------------------------
-- Membership helpers
-- ---------------------------------------------------------------------------
-- `security definer` is load-bearing here, in two ways:
--   1. it lets the function read `property_members` without triggering that
--      table's own policies, which would recurse infinitely
--   2. it means the function runs with the owner's rights, so `search_path`
--      MUST be pinned empty and every reference schema-qualified — otherwise a
--      caller could shadow `property_members` with a table of their own and
--      grant themselves any property they liked
--
-- `(select auth.uid())` rather than a bare `auth.uid()`: wrapping it in a
-- subquery lets Postgres evaluate it once per statement instead of once per
-- row. On the arrivals list for a busy property the difference is not subtle.

create or replace function public.user_property_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select property_id
  from public.property_members
  where user_id = (select auth.uid())
$$;

comment on function public.user_property_ids() is
  'Properties the current user belongs to, in any role. Basis of every read policy.';

create or replace function public.user_property_ids_admin()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select property_id
  from public.property_members
  where user_id = (select auth.uid())
    and role = 'owner'
$$;

comment on function public.user_property_ids_admin() is
  'Properties the current user may administer: settings, membership, authority map. Owners only.';

-- Note there is deliberately no third helper for "may write domain rows". V1
-- has two roles and both operate the hotel — a seasonal receptionist confirms
-- arrivals and answers guests, which are writes (E5.5). Inventing a distinction
-- the product does not have would produce a function whose name lies. When a
-- read-only role appears, it gets its own helper and its own ADR.

-- ---------------------------------------------------------------------------
-- Creating a property
-- ---------------------------------------------------------------------------
-- Chicken and egg: a user may only see properties they are a member of, but a
-- newly created property has no members yet. This trigger closes the gap by
-- making the creator its owner in the same transaction.
--
-- The null guard matters: inserts made by the worker or a seed have no JWT, so
-- `auth.uid()` is null. Without the guard every one of them fails on the
-- not-null user_id, and the failure looks like a schema bug rather than a
-- missing session.

create or replace function public.handle_new_property()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    insert into public.property_members (user_id, property_id, role)
    values ((select auth.uid()), new.id, 'owner');
  end if;
  return new;
end;
$$;

create trigger on_property_created
  after insert on public.properties
  for each row execute function public.handle_new_property();

-- ---------------------------------------------------------------------------
-- Keep a profile in step with the auth user
-- ---------------------------------------------------------------------------
-- Every signed-up person gets a profile row immediately. The alternative —
-- creating it lazily on first read — means every caller must handle "no profile
-- yet", and one of them eventually will not.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------------
-- Enabling without adding policies denies everything, which is the correct
-- default. EVERY new table must appear in this list — see
-- docs/runbooks/rls-policies-map.md.

alter table public.properties       enable row level security;
alter table public.profiles         enable row level security;
alter table public.property_members enable row level security;
alter table public.external_refs    enable row level security;
alter table public.guests           enable row level security;
alter table public.room_types       enable row level security;
alter table public.rate_snapshots   enable row level security;
alter table public.reservations     enable row level security;
alter table public.domain_events    enable row level security;
alter table public.agent_runs       enable row level security;

-- ---------------------------------------------------------------------------
-- properties
-- ---------------------------------------------------------------------------
create policy properties_select on public.properties
  for select to authenticated
  using (id in (select public.user_property_ids()));

-- Any authenticated user may create a property; the trigger above makes them
-- its owner. `with check (true)` is intentional and safe because the new row is
-- only reachable afterwards through the membership just created.
create policy properties_insert on public.properties
  for insert to authenticated
  with check (true);

create policy properties_update on public.properties
  for update to authenticated
  using (id in (select public.user_property_ids_admin()))
  with check (id in (select public.user_property_ids_admin()));

-- No delete policy: properties are never deleted from the client. Reservations,
-- events and agent runs cascade off them, and a hotel that stops using the
-- product still has an audit trail somebody may be legally required to produce.

-- ---------------------------------------------------------------------------
-- profiles  (ADR-017 — isolated by identity, not by property)
-- ---------------------------------------------------------------------------
-- The one table here with no property_id. A person reads and writes their own
-- row and nobody else's. This is a different assertion from every policy below
-- it and does not follow from any of them, which is why the suite tests it
-- separately.

create policy profiles_select on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy profiles_update on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- property_members
-- ---------------------------------------------------------------------------
-- Readable by every member: who else works here is ordinary information, and
-- the console hides the controls a staff member cannot use.
create policy property_members_select on public.property_members
  for select to authenticated
  using (property_id in (select public.user_property_ids()));

create policy property_members_insert on public.property_members
  for insert to authenticated
  with check (property_id in (select public.user_property_ids_admin()));

create policy property_members_update on public.property_members
  for update to authenticated
  using (property_id in (select public.user_property_ids_admin()))
  with check (property_id in (select public.user_property_ids_admin()));

create policy property_members_delete on public.property_members
  for delete to authenticated
  using (property_id in (select public.user_property_ids_admin()));

-- ---------------------------------------------------------------------------
-- Domain tables
-- ---------------------------------------------------------------------------
-- The template every future domain table follows: read for members, write for
-- members, both scoped by property_id.
--
-- Note that update carries BOTH `using` and `with check`. Without the second, a
-- member could move a row into another property by updating its property_id —
-- the row passes `using` on the way in and lands somewhere they must not be
-- able to write. That is a tenant breach committed with an ordinary UPDATE.

create policy guests_select on public.guests
  for select to authenticated
  using (property_id in (select public.user_property_ids()));

create policy guests_insert on public.guests
  for insert to authenticated
  with check (property_id in (select public.user_property_ids()));

create policy guests_update on public.guests
  for update to authenticated
  using (property_id in (select public.user_property_ids()))
  with check (property_id in (select public.user_property_ids()));

-- No delete: GDPR erasure anonymises a guest, it does not drop the row. The
-- reservation that points at it has to survive (E8, and the fiscal-adjacent
-- retention minimum in PRD D6).

create policy room_types_select on public.room_types
  for select to authenticated
  using (property_id in (select public.user_property_ids()));

create policy room_types_insert on public.room_types
  for insert to authenticated
  with check (property_id in (select public.user_property_ids_admin()));

create policy room_types_update on public.room_types
  for update to authenticated
  using (property_id in (select public.user_property_ids_admin()))
  with check (property_id in (select public.user_property_ids_admin()));

create policy room_types_delete on public.room_types
  for delete to authenticated
  using (property_id in (select public.user_property_ids_admin()));

-- rate_snapshots is a display cache written by the sync engine, never by a
-- person. Members read it; nobody writes it through a session. Pruning old
-- snapshots is a worker job running with the service role, which is why there
-- is no delete policy here rather than an admin one.
create policy rate_snapshots_select on public.rate_snapshots
  for select to authenticated
  using (property_id in (select public.user_property_ids()));

create policy reservations_select on public.reservations
  for select to authenticated
  using (property_id in (select public.user_property_ids()));

create policy reservations_insert on public.reservations
  for insert to authenticated
  with check (property_id in (select public.user_property_ids()));

create policy reservations_update on public.reservations
  for update to authenticated
  using (property_id in (select public.user_property_ids()))
  with check (property_id in (select public.user_property_ids()));

-- No delete: a reservation is cancelled by status, never removed. Money and
-- attribution evidence hang off it, and the monthly report is the invoice.

-- external_refs is written only by the sync engine (service role). Members read
-- it so the console can show what reflected and what has not.
create policy external_refs_select on public.external_refs
  for select to authenticated
  using (property_id in (select public.user_property_ids()));

-- ---------------------------------------------------------------------------
-- domain_events — append-only
-- ---------------------------------------------------------------------------
-- Insert is allowed for members because a user-path mutation emits its own
-- event inside the same transaction (binding rule 2). There is deliberately no
-- update and no delete policy: an event log that can be rewritten answers no
-- question worth asking, and this one is the basis of the zero-touch metric,
-- the agent audit trail and reconciliation.

create policy domain_events_select on public.domain_events
  for select to authenticated
  using (property_id in (select public.user_property_ids()));

create policy domain_events_insert on public.domain_events
  for insert to authenticated
  with check (property_id in (select public.user_property_ids()));

-- ---------------------------------------------------------------------------
-- agent_runs
-- ---------------------------------------------------------------------------
-- Written by the runner in the worker (service role). Members read them — the
-- console renders T2 proposals as diff-cards — and members update them, because
-- accepting or rejecting a proposal writes `outcome` and `reviewed_by`. That
-- column is the evidence a tier may widen (06 §4), so it has to be writable by
-- the human doing the reviewing.
--
-- No insert policy for a session: an agent run recorded by a person would be a
-- forged audit entry.

create policy agent_runs_select on public.agent_runs
  for select to authenticated
  using (property_id in (select public.user_property_ids()));

create policy agent_runs_update on public.agent_runs
  for update to authenticated
  using (property_id in (select public.user_property_ids()))
  with check (property_id in (select public.user_property_ids()));
