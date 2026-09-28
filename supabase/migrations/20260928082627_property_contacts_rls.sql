-- The people a property pages, owner-only (privacy runbook, "Owner and staff
-- contact numbers"). Ships with the migration that creates the table (binding
-- rule 9).

alter table public.property_contacts enable row level security;

-- ---------------------------------------------------------------------------
-- property_contacts
-- ---------------------------------------------------------------------------
-- Owners only, for every command. These are personal phone numbers, the
-- owner's own among them; a receptionist has no reason to read them, which is
-- the reason they left `properties.settings`, readable by any member.
--
-- The service role reads them to page someone or to recognise the owner on
-- WhatsApp, always scoped by property_id (ADR-007).

create policy property_contacts_select on public.property_contacts
  for select to authenticated
  using (property_id in (select public.user_property_ids_admin()));

create policy property_contacts_insert on public.property_contacts
  for insert to authenticated
  with check (property_id in (select public.user_property_ids_admin()));

create policy property_contacts_update on public.property_contacts
  for update to authenticated
  using (property_id in (select public.user_property_ids_admin()))
  with check (property_id in (select public.user_property_ids_admin()));

create policy property_contacts_delete on public.property_contacts
  for delete to authenticated
  using (property_id in (select public.user_property_ids_admin()));

revoke truncate on table public.property_contacts from anon, authenticated;
revoke all on table public.property_contacts from anon;

-- ---------------------------------------------------------------------------
-- Carry the numbers over from settings, then remove them there
-- ---------------------------------------------------------------------------
-- A number is kept only in a form every reader already accepted: `+` and
-- digits, or `00` and digits. Anything else never paged anyone and is dropped
-- rather than guessed at. `informed_at` stays null: nobody has said the person
-- was told, and the screen asks.

insert into public.property_contacts (property_id, role, name, phone)
select p.id, c.role, c.label, c.phone
  from public.properties p
  cross join lateral (
    select 'owner' as role, 'Owner' as label, value as raw
      from jsonb_array_elements_text(
        case when jsonb_typeof(p.settings -> 'ownerPhones') = 'array'
             then p.settings -> 'ownerPhones' else '[]'::jsonb end)
    union all
    select 'staff', 'Staff', value
      from jsonb_array_elements_text(
        case when jsonb_typeof(p.settings -> 'staffPhones') = 'array'
             then p.settings -> 'staffPhones' else '[]'::jsonb end)
  ) as r
  cross join lateral (
    select r.role, r.label,
           case
             when btrim(r.raw) like '+%' then '+' || regexp_replace(r.raw, '\D', '', 'g')
             when regexp_replace(r.raw, '\D', '', 'g') like '00%'
               then '+' || substr(regexp_replace(r.raw, '\D', '', 'g'), 3)
           end as phone
  ) as c
 where c.phone ~ '^\+[1-9][0-9]{6,14}$'
on conflict (property_id, role, phone) do nothing;

update public.properties
   set settings = settings - 'ownerPhones' - 'staffPhones'
 where settings ?| array['ownerPhones', 'staffPhones'];
