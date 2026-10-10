-- Group settings, Admin management, ownership transfer and Group deletion.
-- Owner-only actions are checked in the database, not just hidden in the UI.

create unique index one_owner_per_group on memberships (group_id) where role = 'owner';

create function is_group_owner(p_group uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships
    where group_id = p_group and person_id = current_person_id() and role = 'owner'
  )
$$;

create function my_group_role(p_group uuid) returns member_role
language sql stable security definer set search_path = public as $$
  select role from memberships
  where group_id = p_group and person_id = current_person_id() and guest_match_id is null
$$;

create function my_groups() returns table (id uuid, name text, my_role member_role)
language sql stable security definer set search_path = public as $$
  select g.id, g.name, m.role
  from groups g join memberships m on m.group_id = g.id
  where m.person_id = current_person_id() and m.guest_match_id is null
  order by g.created_at
$$;

-- Any argument left null keeps its current value.
create function update_group(
  p_group uuid, p_name text default null, p_min_players int default null, p_show_team_strength boolean default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_group_admin(p_group) then raise exception 'only an admin can change group settings'; end if;
  update groups set
    name = coalesce(trim(p_name), name),
    min_players = coalesce(p_min_players, min_players),
    show_team_strength = coalesce(p_show_team_strength, show_team_strength)
  where id = p_group;
end $$;

create function promote_admin(p_membership uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_target memberships;
begin
  select * into v_target from memberships where id = p_membership;
  if not found or not is_group_owner(v_target.group_id) then
    raise exception 'only the owner can change who is an admin';
  end if;
  if v_target.role <> 'member' then raise exception 'only a regular member can be promoted'; end if;
  if v_target.person_id is null or v_target.claim <> 'confirmed' or v_target.guest_match_id is not null then
    raise exception 'only confirmed members can become admins';
  end if;
  update memberships set role = 'admin' where id = p_membership;
end $$;

create function demote_admin(p_membership uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_target memberships;
begin
  select * into v_target from memberships where id = p_membership;
  if not found or not is_group_owner(v_target.group_id) then
    raise exception 'only the owner can change who is an admin';
  end if;
  if v_target.role <> 'admin' then raise exception 'only admins can be demoted'; end if;
  update memberships set role = 'member' where id = p_membership;
end $$;

-- The old Owner becomes an Admin first, so there is never a moment with two Owners or none.
create function transfer_ownership(p_to uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_target memberships; v_owner uuid;
begin
  select * into v_target from memberships where id = p_to;
  if not found or not is_group_owner(v_target.group_id) then
    raise exception 'only the owner can transfer ownership';
  end if;
  if v_target.role <> 'admin' then raise exception 'ownership can only be transferred to an admin'; end if;
  select id into v_owner from memberships where group_id = v_target.group_id and role = 'owner';
  update memberships set role = 'admin' where id = v_owner;
  update memberships set role = 'owner' where id = p_to;
end $$;

create function delete_group(p_group uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_group_owner(p_group) then raise exception 'only the owner can delete the group'; end if;
  delete from groups where id = p_group;
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
