-- RLS for the reconciliation surface.
--
-- Ships with the migration that creates the tables (binding rule 9). A table
-- created in one change and policed in the next is a table that leaks for
-- however long the second change takes to arrive.
--
-- Reconciliation output is a product surface, not a log file (03 §4): owners
-- read their own parity trend and resolve their own discrepancies. Both tables
-- are therefore client-reachable and both need policies.

alter table public.reconciliation_runs enable row level security;
alter table public.discrepancies       enable row level security;

-- ---------------------------------------------------------------------------
-- reconciliation_runs
-- ---------------------------------------------------------------------------
-- Read-only from a session. Runs are written by the nightly job under the
-- service role; a run recorded by a person would be a fabricated parity
-- measurement, and these rows are the evidence D11's condition C2 asks for.

create policy reconciliation_runs_select on public.reconciliation_runs
  for select to authenticated
  using (property_id in (select public.user_property_ids()));

-- ---------------------------------------------------------------------------
-- discrepancies
-- ---------------------------------------------------------------------------
-- Members read them and members resolve them. Resolving writes `status`,
-- `explanation`, `resolved_by` and `resolved_at` — the one-tap action the
-- exceptions inbox offers (PRD C1), so update has to be reachable from a
-- session.
--
-- Insert stays with the job: a discrepancy is an observation about two systems
-- disagreeing, and a person cannot observe that into existence.
--
-- Note both `using` and `with check` on update. Without the second, a member
-- could move a discrepancy onto another property by updating its property_id —
-- it would pass `using` on the way in and land where they cannot write.

create policy discrepancies_select on public.discrepancies
  for select to authenticated
  using (property_id in (select public.user_property_ids()));

create policy discrepancies_update on public.discrepancies
  for update to authenticated
  using (property_id in (select public.user_property_ids()))
  with check (property_id in (select public.user_property_ids()));

-- No delete, on either table. A discrepancy that was explained away and then
-- deleted leaves a parity ratio nobody can reproduce, and the ratio is the
-- number the fiscal-core gate turns on.
