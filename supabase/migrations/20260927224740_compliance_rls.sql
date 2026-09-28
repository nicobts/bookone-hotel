-- RLS and the append-only guard for compliance obligations and evidence
-- (ADR-039, Guest Desk WP1.1).
--
-- Ships with the migration that creates the tables (binding rule 9).

alter table public.compliance_obligations enable row level security;
alter table public.compliance_evidence enable row level security;

-- ---------------------------------------------------------------------------
-- compliance_obligations
-- ---------------------------------------------------------------------------
-- Members read them: the obligation is the property's, and a property that
-- cannot see what it owes, and by when, is taking our word for it.
--
-- No insert, update or delete policy. Obligations are generated from confirmed
-- schedine and arrivals and advanced by the lifecycle (`compliance/lifecycle.ts`)
-- under the service role, scoped by property_id (ADR-007). A hand-written row
-- would claim an obligation or a state no authority saw.

create policy compliance_obligations_select on public.compliance_obligations
  for select to authenticated
  using (property_id in (select public.user_property_ids()));

-- ---------------------------------------------------------------------------
-- compliance_evidence
-- ---------------------------------------------------------------------------
-- Members read it, for the same reason and more: this is what a property shows
-- an inspector.
--
-- No write policy, and more than that — no client privilege beyond select.
-- Supabase's default privileges grant anon and authenticated every table
-- privilege, TRUNCATE included, and RLS does not govern TRUNCATE.

create policy compliance_evidence_select on public.compliance_evidence
  for select to authenticated
  using (property_id in (select public.user_property_ids()));

revoke insert, update, delete, truncate on table public.compliance_evidence from anon, authenticated;
revoke all on table public.compliance_evidence from anon;

-- Append-only, enforced by the database. Allowed, and nothing else:
--
--   * INSERT;
--   * the retention sweep blanking the receipt: `receipt` becomes '{}' and
--     `receipt_purged_at` is stamped, once, with every other column unchanged —
--     the hash keeps proving the filing;
--   * DELETE when the owning property itself is gone (its deletion cascades
--     here). Evidence never outlives the property's decision to leave, and
--     never goes before it.
--
-- TRUNCATE is not trapped here, unlike admin_audit: `truncate properties
-- cascade` reaches this table, and that is the same act as deleting every
-- property. No client role holds TRUNCATE (revoked above); only the database
-- owner can, and only as an operation on the whole platform.
--
-- Never write a migration that loosens this (CLAUDE.md, ADR-039). A correction
-- is a new row.

create or replace function public.compliance_evidence_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.properties p where p.id = old.property_id) then
      return old;
    end if;
    raise exception 'compliance_evidence is append-only: DELETE is not allowed'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'UPDATE' then
    if old.receipt_purged_at is null
      and new.receipt_purged_at is not null
      and new.receipt = '{}'::jsonb
      and new.id = old.id
      and new.property_id = old.property_id
      and new.obligation_id = old.obligation_id
      and new.source = old.source
      and new.receipt_hash = old.receipt_hash
      and new.recorded_at = old.recorded_at
      and new.recorded_by is not distinct from old.recorded_by
    then
      return new;
    end if;
    raise exception 'compliance_evidence is append-only: only the retention purge may update it'
      using errcode = 'insufficient_privilege';
  end if;

  raise exception 'compliance_evidence is append-only: % is not allowed', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger compliance_evidence_guard
  before update or delete on public.compliance_evidence
  for each row execute function public.compliance_evidence_append_only();
