-- RLS for the files recorded with a manual filing, and their private bucket
-- (Guest Desk WP1.6).
--
-- Ships with the migration that creates the table (binding rule 9).

alter table public.compliance_attachments enable row level security;

-- Members read the rows: the receipt of a filing is the property's, and it is
-- what the property shows an inspector. A row holds a path, a type, a size and
-- a hash; the file itself is only ever reached through a signed URL minted
-- server-side after the same membership check.
--
-- No write policy and no client privilege beyond select. Rows are written by
-- `recordManualFiling` under the service role, scoped by property_id (ADR-007),
-- in the same transaction as the evidence they belong to; the retention job
-- stamps `deleted_at`. A hand-written row would claim a receipt nobody filed.

create policy compliance_attachments_select on public.compliance_attachments
  for select to authenticated
  using (property_id in (select public.user_property_ids()));

revoke insert, update, delete, truncate on table public.compliance_attachments from anon, authenticated;
revoke all on table public.compliance_attachments from anon;

-- ---------------------------------------------------------------------------
-- The bucket. Private, like identity-documents, for the same reason: the
-- portal's receipt may list the party's names. No storage policy grants the
-- `authenticated` role anything; the console uploads through a server action
-- and reads through a short-lived signed URL, both under the service role in
-- our own process. EU-resident: the same Supabase project as everything else.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'compliance-receipts',
  'compliance-receipts',
  false,
  -- 10 MB. A portal receipt is a one-page PDF or a screenshot.
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
