-- RLS for the Alloggiati audit trail.
--
-- Ships with the migration that creates the table (binding rule 9).
--
-- This table is a property's evidence that it met a legal obligation. It is
-- also, in `payload`, a list of passport numbers. Both facts shape the policy.

alter table public.alloggiati_submissions enable row level security;

-- ---------------------------------------------------------------------------
-- alloggiati_submissions
-- ---------------------------------------------------------------------------
-- Members read them. Not a courtesy: the property is the declarant, the
-- obligation is theirs, and an audit trail the declarant cannot inspect is not
-- an audit trail — it is our word for it. When a Questura asks what was filed
-- for a guest, the owner needs to be able to answer without us.
--
-- No insert, update or delete policy:
--
--   * insert belongs to the staging path, which validates the party against
--     the record schema first. A hand-written submission row would assert that
--     a filing exists when none does — and this row is what a property would
--     produce to show it complied.
--   * update belongs to the submission path. `status`, `receipt` and
--     `acknowledged_at` are a record of what an authority actually said; a
--     hand-edited acknowledgement is worse than none, because it looks like
--     proof.
--   * delete would destroy the only remaining evidence of a filing whose
--     identity documents have already been erased under E2.4. After that
--     deletion this row is all there is.
--
-- All of those paths run in the worker under the service role, still scoping
-- every query by property_id explicitly (ADR-007, binding rule 3).

create policy alloggiati_submissions_select on public.alloggiati_submissions
  for select to authenticated
  using (property_id in (select public.user_property_ids()));
