-- ---------------------------------------------------------------------------
-- admin_audit (ADR-031, Guest Desk WP0.8)
-- ---------------------------------------------------------------------------
-- Every operator action, append-only.
--
-- RLS on and no policy for `authenticated`: no hotel user, owner or staff, can
-- read or write it through any client path. The admin app writes it under the
-- service role, scoped by the audited operation itself.
--
-- Append-only is enforced by the database, not by convention: UPDATE, DELETE
-- and TRUNCATE all raise. Never write a migration that loosens this (CLAUDE.md);
-- a correction is a new row that says what it corrects.

alter table public.admin_audit enable row level security;

-- Supabase's default privileges grant every table privilege to `anon` and
-- `authenticated`, TRUNCATE included — and RLS does not govern TRUNCATE. No
-- client role has any business with this table, so it holds no privilege on
-- it at all; the policy-less RLS above and the trigger below are the second
-- and third lines, not the first.
revoke all on table public.admin_audit from anon, authenticated;

create or replace function public.admin_audit_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'admin_audit is append-only: % is not allowed', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger admin_audit_no_update
  before update or delete on public.admin_audit
  for each row execute function public.admin_audit_append_only();

create trigger admin_audit_no_truncate
  before truncate on public.admin_audit
  for each statement execute function public.admin_audit_append_only();
