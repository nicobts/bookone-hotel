-- ---------------------------------------------------------------------------
-- complaints (Guest Desk WP0.3)
-- ---------------------------------------------------------------------------
-- A guest's complaint, with an SLA clock. Written by the concierge's
-- `log_complaint` tool under the service role (scoped explicitly, ADR-007) and
-- worked by staff in the console.
--
-- Members read, add and update — staff log complaints made at the desk, and
-- acknowledge and resolve them. No delete: a complaint resolved is information,
-- a complaint deleted looks as though nobody ever complained. Erasure (E8.1)
-- runs under the service role and is the only path that removes a row.

alter table public.complaints enable row level security;

create policy complaints_select on public.complaints
  for select to authenticated
  using (property_id in (select public.user_property_ids()));

create policy complaints_insert on public.complaints
  for insert to authenticated
  with check (property_id in (select public.user_property_ids()));

create policy complaints_update on public.complaints
  for update to authenticated
  using (property_id in (select public.user_property_ids()))
  with check (property_id in (select public.user_property_ids()));
