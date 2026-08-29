-- RLS for attribution, subscriptions, the monthly report and disputes (E5.4).
--
-- Ships with the migration that creates the tables (binding rule 9).
--
-- Everything here is money the property is billed. That shapes the policy in a
-- direction worth stating plainly: **members read all of it, and write almost
-- none of it.**
--
-- Reading is not a courtesy. PRD C4 makes this report the invoice basis and M6
-- makes trust the moat — an owner who cannot inspect the evidence behind a
-- charge has been asked to take our word for it, which is the thing the whole
-- surface exists to avoid. Staff read it too, and deliberately: the fee rows
-- already work that way (footnote 18), and a receptionist who can see the
-- booking but not what it cost cannot answer the owner's question either.
--
-- Writing is a different matter. A fee, an attribution event and an issued
-- report are all *evidence*, and evidence a party to the dispute can edit is
-- not evidence. The one exception is the dispute itself, which is the owner's
-- own instrument and belongs to them.

alter table public.attribution_events enable row level security;
alter table public.subscriptions enable row level security;
alter table public.monthly_reports enable row level security;
alter table public.fee_disputes enable row level security;

-- ---------------------------------------------------------------------------
-- attribution_events
-- ---------------------------------------------------------------------------
-- Read-only from a session, and the reason is the whole design of D14's
-- attribution rule.
--
-- These rows decide whether a booking is billed at 2–4% or at 8–12%. A row that
-- could be written from a session would let somebody manufacture "an engine
-- session preceded this" — moving a fee *down* — or delete one to move it up.
-- Either direction, the number on the invoice would rest on a table a party to
-- the invoice could edit.
--
-- Written by the booking surface and the concierge under the service role, each
-- scoped to one property explicitly (ADR-007, binding rule 3). Retention is the
-- E8 job's decision on a schedule, not a delete policy.

create policy attribution_events_select on public.attribution_events
  for select to authenticated
  using (property_id in (select public.user_property_ids()));

-- ---------------------------------------------------------------------------
-- subscriptions
-- ---------------------------------------------------------------------------
-- Read-only, owners and staff.
--
-- What a property pays for the platform is agreed in a contract, not set in the
-- product — so there is no path from a session to changing it, in either
-- direction. Recording a new plan is ending the current row and inserting the
-- next, which is a deliberate act by us with a contract behind it.
--
-- `rooms` sits here for the same reason: it is the divisor in the €/room/month
-- equivalence (ADR-015, D20), which is the line an owner compares against a
-- competitor's price. A number the billed party can edit is not a comparison
-- anybody should trust, in either direction.

create policy subscriptions_select on public.subscriptions
  for select to authenticated
  using (property_id in (select public.user_property_ids()));

-- ---------------------------------------------------------------------------
-- monthly_reports
-- ---------------------------------------------------------------------------
-- Read-only from a session.
--
-- A draft is recomputed by the generator; an issued report is frozen and its
-- snapshot is the statement. Neither is a thing a person edits — the point of
-- the snapshot is that it does not change, and a policy allowing an update
-- would make "frozen" a convention rather than a property of the system
-- (design-notes/monthly-report.md §4A).
--
-- Nothing here is a fiscal document (D11, binding rule 6): it is the basis from
-- which we invoice the property, computes no tax, issues nothing, and is
-- transmitted to no authority.

create policy monthly_reports_select on public.monthly_reports
  for select to authenticated
  using (property_id in (select public.user_property_ids()));

-- ---------------------------------------------------------------------------
-- fee_disputes
-- ---------------------------------------------------------------------------
-- The one billing table a member may write, and the only insert policy in this
-- migration.
--
-- D14: disputes resolve in the owner's favour. An owner who has to open a
-- support ticket to disagree with a charge is an owner whose disagreement is
-- rate-limited by our availability — so raising one is a row they write
-- themselves, from the line they are looking at.
--
-- `raised_by` is pinned to the caller for the same reason `messages.author_user_id`
-- is: a dispute is a statement by a named person, and one attributed to somebody
-- else is a forged record of who objected.
--
-- No update and no delete. The credit is applied when the dispute is raised, so
-- there is no adjudication step to edit — and withdrawing a dispute is a
-- conversation, not a button that removes the evidence it happened.

create policy fee_disputes_select on public.fee_disputes
  for select to authenticated
  using (property_id in (select public.user_property_ids()));

create policy fee_disputes_insert on public.fee_disputes
  for insert to authenticated
  with check (
    property_id in (select public.user_property_ids())
    and raised_by = (select auth.uid())
  );
