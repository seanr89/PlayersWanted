-- Anonymous sign-in is for players. Starting a Group needs a real account, so anonymous users cannot mint
-- unlimited Groups by calling the command directly (the UI gate on its own is only cosmetic).
--
-- The rule is a setting, ON by default. The integration tests switch it off while they run (they use anonymous
-- users as stand-in organisers) and one test switches it on to check it.

create table app_settings (
  key text primary key,
  bool_value boolean not null
);
insert into app_settings (key, bool_value) values ('require_account_to_create_group', true);
alter table app_settings enable row level security; -- no policies: only the database owner and service role touch it
revoke all on app_settings from anon, authenticated;

create or replace function public.create_group(p_name text, p_owner_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_person uuid; v_group uuid; v_membership uuid;
begin
  -- Organisers need a real account (an emailed link or, later, Google/Apple). Anonymous sign-in is for players, so
  -- it must not be able to mint Groups. The rule is a setting so tests can stand anonymous users in for organisers.
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
     and coalesce((select bool_value from app_settings where key = 'require_account_to_create_group'), true) then
    raise exception 'sign in with your email to start a group';
  end if;
  v_person := ensure_person(p_owner_name);
  insert into groups (name) values (trim(p_name)) returning id into v_group;
  insert into memberships (group_id, person_id, display_name, role, claim)
    values (v_group, v_person, trim(p_owner_name), 'owner', 'confirmed')
    returning id into v_membership;
  insert into membership_ratings (membership_id) values (v_membership);
  return v_group;
end $function$;

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function claim_pending_notifications(int) from public, anon, authenticated;
grant execute on function claim_pending_notifications(int) to service_role;
