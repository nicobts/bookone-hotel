-- RLS for per-property feature entitlements (E7.3).
--
-- Ships with the migration that creates the table (binding rule 9).
--
-- One policy, and the shape of it is the whole decision: **members read, nobody
-- writes.**
--
-- Reading matters. An owner who cannot see which modules their property has is
-- an owner who cannot check the module line on their statement (D14 row 4), and
-- the report exists to be checkable. Staff read it too, for the same reason the
-- fee rows are readable by staff: a receptionist who can see a feature is
-- missing can say so, and one who cannot will report it as a fault.
--
-- Writing is a contract term. A property granting itself a module is a property
-- taking something it has not bought; a property revoking one is a support call
-- arriving as a mystery. Both directions are wrong from a session, so grants are
-- made by us, deliberately, under the service role.

alter table public.entitlements enable row level security;

-- ---------------------------------------------------------------------------
-- entitlements
-- ---------------------------------------------------------------------------
-- No insert, update or delete policy:
--
--   * insert would let a property enable a paid module for itself.
--   * update would let it move `granted_at` — the answer to "since when", which
--     is the only question that matters in a billing dispute about a module.
--   * delete would erase the record that a feature was ever live, which is
--     exactly what somebody would want deleted after arguing about it.
--
-- Revoking ends a row rather than removing it, so "never had it" and "had it
-- until March" stay distinguishable.

create policy entitlements_select on public.entitlements
  for select to authenticated
  using (property_id in (select public.user_property_ids()));
