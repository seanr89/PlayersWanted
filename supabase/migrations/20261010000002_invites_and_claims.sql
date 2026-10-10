-- Invite links, ghost-profile claims and claim confirmation.

-- The invite token is a secret the admin shares into WhatsApp: only expose it via get_invite_token.
revoke select on groups from authenticated;
grant select (id, name, min_players, show_team_strength, created_at) on groups to authenticated;

create function get_invite_token(p_group uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  if not is_group_admin(p_group) then raise exception 'only an admin can see the invite link'; end if;
  select invite_token into v_token from groups where id = p_group;
  return v_token;
end $$;

-- What someone sees after opening the invite link: "which one are you?"
create function get_invite(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_group groups;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_group from groups where invite_token = p_token;
  if not found then raise exception 'invalid invite'; end if;
  return jsonb_build_object(
    'groupName', v_group.name,
    'ghosts', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'displayName', display_name) order by created_at)
      from memberships where group_id = v_group.id and claim = 'ghost'
    ), '[]'::jsonb)
  );
end $$;

-- Join as a new Membership, or claim a ghost profile (instant, but pending admin confirmation).
create function join_group(p_token text, p_name text, p_claim uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_group uuid; v_person uuid; v_membership uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select id into v_group from groups where invite_token = p_token;
  if v_group is null then raise exception 'invalid invite'; end if;

  v_person := ensure_person(p_name);
  if exists (select 1 from memberships where group_id = v_group and person_id = v_person) then
    raise exception 'already a member of this group';
  end if;

  if p_claim is not null then
    update memberships set person_id = v_person, claim = 'pending'
      where id = p_claim and group_id = v_group and person_id is null and claim = 'ghost'
      returning id into v_membership;
    if v_membership is null then raise exception 'that profile has already been claimed'; end if;
  else
    insert into memberships (group_id, person_id, display_name, role, claim)
      values (v_group, v_person, trim(p_name), 'member', 'confirmed')
      returning id into v_membership;
    insert into membership_ratings (membership_id) values (v_membership);
  end if;
  return v_membership;
end $$;

create function confirm_claim(p_membership uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid;
begin
  select group_id into v_group from memberships where id = p_membership and claim = 'pending';
  if v_group is null or not is_group_admin(v_group) then
    raise exception 'only an admin can confirm a pending claim';
  end if;
  update memberships set claim = 'confirmed' where id = p_membership;
end $$;

create function reject_claim(p_membership uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid;
begin
  select group_id into v_group from memberships where id = p_membership and claim = 'pending';
  if v_group is null or not is_group_admin(v_group) then
    raise exception 'only an admin can reject a pending claim';
  end if;
  update memberships set person_id = null, claim = 'ghost' where id = p_membership;
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
