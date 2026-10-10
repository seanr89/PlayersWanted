-- The invite link already identifies the Group to whoever holds it, so tell them its id: after joining, the
-- app needs to open that Group.

create or replace function get_invite(p_token text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_group groups;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_group from groups where invite_token = p_token;
  if not found then raise exception 'invalid invite'; end if;
  return jsonb_build_object(
    'groupId', v_group.id,
    'groupName', v_group.name,
    'ghosts', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'displayName', display_name) order by created_at)
      from memberships where group_id = v_group.id and claim = 'ghost' and not departed
    ), '[]'::jsonb)
  );
end $$;
