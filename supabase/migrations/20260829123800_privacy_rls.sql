-- RLS for the data-subject request desk (E8.1).
--
-- Ships with the migration that creates the table (binding rule 9).
--
-- One policy: **owners read, nobody writes from a session.**
--
-- Owners rather than members, and this is the one table where narrowing to
-- owners is about the *subject* rather than about the property. A privacy
-- request names a guest and records that they asked to be forgotten, which is
-- a fact about a person that the receptionist who checked them in has no reason
-- to hold. E5.5 gives staff five surfaces; this is not one of them, and the
-- policy is why — a hidden nav item is not a permission.
--
-- No insert, update or delete policy, for the same reason `monthly_reports` and
-- `entitlements` have none: the row is written by the machinery that acts on
-- it, in the same transaction as the event that proves it happened. A row
-- inserted by hand would claim a request was raised with nothing acting on it,
-- and one updated by hand would move `completed_at` — which is the column that
-- answers "did you respond within the month", the only question Art. 12(3)
-- actually asks.

alter table public.privacy_requests enable row level security;

-- ---------------------------------------------------------------------------
-- privacy_requests
-- ---------------------------------------------------------------------------

create policy privacy_requests_select on public.privacy_requests
  for select to authenticated
  using (property_id in (select public.user_property_ids_admin()));
