-- Fixes from review of the removal / anonymisation work.
--
-- Note on what "anonymised" means here: the placeholder keeps its row id, so someone who cached an id
-- could still follow that one pseudonymous history. Everything that names or characterises the person is
-- gone, but this is pseudonymisation of past appearances, not full unlinkability.

-- The owner-check trigger function is internal.
alter function check_group_has_owner() set schema private;

create or replace function private.anonymise_membership(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_guest boolean;
begin
  select guest_match_id is not null into v_guest from memberships where id = p_id;
  update memberships set
    display_name = case when v_guest then 'Former guest' else 'Former player' end,
    person_id = null, departed = true, claim = 'confirmed', role = 'member',
    position = null, happy_in_goal = false,
    created_at = 'epoch'::timestamptz -- the join date would help re-identify them
  where id = p_id;
  delete from membership_ratings where membership_id = p_id;
  delete from pair_rules where a_membership_id = p_id or b_membership_id = p_id;
  -- A fix that was dismissed for this person embeds their id.
  update teams set dismissed_fix_key = null where dismissed_fix_key like '%' || p_id::text || '%';
  -- Keep only what Results and attendance need: appearances (being on the Teams and RSVPed in) for played
  -- matches. Everything else about their behaviour (out RSVPs, late dropouts, upcoming plans) goes.
  delete from rsvps r using matches m
    where r.membership_id = p_id and m.id = r.match_id
      and (m.status in ('scheduled', 'rsvps_open', 'teams_published', 'cancelled')
           or (m.status = 'played' and (r.response = 'out' or not exists (
                 select 1 from team_players tp where tp.match_id = r.match_id and tp.membership_id = r.membership_id))));
  -- Published Teams keep the slot, so the minimal-change fix sees a vacated place.
  delete from team_players tp using matches m
    where tp.membership_id = p_id and m.id = tp.match_id and m.status in ('scheduled', 'rsvps_open', 'cancelled');
  delete from memberships
    where id = p_id
      and not exists (select 1 from rsvps where membership_id = p_id)
      and not exists (select 1 from team_players where membership_id = p_id);
end $$;

-- A member and the Guests they brought go together. Someone who only *claimed* an Admin-named ghost profile
-- (never confirmed) releases it: the profile, and its history, go back to the unclaimed list.
create or replace function private.depart(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_guest uuid;
begin
  for v_guest in select id from memberships where sponsor_membership_id = p_id loop
    perform private.anonymise_membership(v_guest);
  end loop;
  update memberships set sponsor_membership_id = null where sponsor_membership_id = p_id;

  if (select claim from memberships where id = p_id) = 'pending' then
    delete from rsvps r using matches m
      where r.membership_id = p_id and m.id = r.match_id
        and m.status in ('scheduled', 'rsvps_open', 'teams_published', 'cancelled');
    update memberships set person_id = null, claim = 'ghost', happy_in_goal = false where id = p_id;
    return;
  end if;
  perform private.anonymise_membership(p_id);
end $$;

create or replace function remove_membership(p_membership uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_target memberships;
begin
  select * into v_target from memberships where id = p_membership;
  if not found or not is_group_admin(v_target.group_id) then
    raise exception 'only an admin can remove a member';
  end if;
  perform 1 from groups where id = v_target.group_id for update;
  if v_target.role = 'owner' then raise exception 'the owner cannot be removed'; end if;
  if v_target.guest_match_id is not null or v_target.departed then
    raise exception 'that is not a current member (guests are removed with remove_guest)';
  end if;
  perform private.depart(p_membership);
end $$;

create or replace function leave_group(p_group uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_me memberships;
begin
  perform 1 from groups where id = p_group for update;
  select * into v_me from memberships
    where group_id = p_group and person_id = current_person_id() and guest_match_id is null and not departed;
  if not found then raise exception 'you are not a member of this group'; end if;
  if v_me.role = 'owner' then
    raise exception 'the owner must transfer ownership or delete the group before leaving';
  end if;
  perform private.depart(v_me.id);
end $$;

create or replace function delete_account() returns void
language plpgsql security definer set search_path = public as $$
declare v_person uuid := current_person_id(); v_m memberships; v_solo_owner_of uuid[] := '{}';
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  for v_m in select * from memberships where person_id = v_person and guest_match_id is null and not departed loop
    if v_m.role = 'owner' then
      -- Locking the group serialises this with anyone joining it at the same moment.
      perform 1 from groups where id = v_m.group_id for update;
      if exists (select 1 from memberships o
                 where o.group_id = v_m.group_id and o.id <> v_m.id and o.guest_match_id is null
                   and o.person_id is not null and not o.departed) then
        raise exception 'transfer ownership of your groups before deleting your account';
      end if;
      v_solo_owner_of := v_solo_owner_of || v_m.group_id;
    end if;
  end loop;

  delete from groups where id = any (v_solo_owner_of);
  for v_m in select * from memberships where person_id = v_person and guest_match_id is null and not departed loop
    perform private.depart(v_m.id);
  end loop;
  delete from person where id = v_person;
  -- Tokens without a session have no foreign key to the user, so they would otherwise survive.
  delete from auth.refresh_tokens where user_id = auth.uid()::text;
  delete from auth.users where id = auth.uid();
end $$;

-- A departed placeholder cannot be handed ownership or brought back to life.
create or replace function transfer_ownership(p_to uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid; v_target memberships; v_owner uuid;
begin
  select group_id into v_group from memberships where id = p_to;
  perform 1 from groups where id = v_group for update;
  select * into v_target from memberships where id = p_to;
  if not found or not is_group_owner(v_target.group_id) then
    raise exception 'only the owner can transfer ownership';
  end if;
  if v_target.role <> 'admin' or v_target.departed then
    raise exception 'ownership can only be transferred to an admin';
  end if;
  select id into v_owner from memberships where group_id = v_target.group_id and role = 'owner';
  update memberships set role = 'admin' where id = v_owner and role = 'owner';
  update memberships set role = 'owner' where id = p_to and role = 'admin';
end $$;

create or replace function promote_guest(p_guest uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_guest memberships;
begin
  select * into v_guest from memberships where id = p_guest;
  if not found or v_guest.guest_match_id is null then raise exception 'that is not a guest'; end if;
  if not is_group_admin(v_guest.group_id) then raise exception 'only an admin can promote a guest'; end if;
  if v_guest.departed then raise exception 'that guest has left'; end if;
  insert into membership_ratings (membership_id, rating)
    select p_guest, coalesce(round(avg(r.rating))::int, 50)
    from membership_ratings r join memberships m on m.id = r.membership_id
    where m.group_id = v_guest.group_id and m.guest_match_id is null
    on conflict (membership_id) do nothing;
  update memberships set guest_match_id = null, sponsor_membership_id = null, claim = 'ghost'
    where id = p_guest;
end $$;

create or replace function join_group(p_token text, p_name text, p_claim uuid default null) returns uuid
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
      where id = p_claim and group_id = v_group and person_id is null and claim = 'ghost' and not departed
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

-- Once a fix is confirmed, a departed player's placeholder may have nothing left to preserve.
create or replace function confirm_fix(p_match uuid, p_team_a uuid[], p_team_b uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_match matches;
  v_new uuid[];
  v_still uuid[];
  v_holders int;
  v_extras uuid[];
  v_queue uuid[];
begin
  select * into v_match from matches where id = p_match;
  if not found or not is_group_admin(v_match.group_id) then raise exception 'only an admin can confirm a fix'; end if;
  if v_match.status <> 'teams_published' then raise exception 'there are no published teams to fix'; end if;
  if p_team_a is null or p_team_b is null then raise exception 'a fix must list both teams'; end if;
  v_new := p_team_a || p_team_b;
  if cardinality(v_new) = 0 or array_position(v_new, null) is not null then
    raise exception 'a fix must list the players on each team';
  end if;
  if cardinality(v_new) <> (select count(distinct x) from unnest(v_new) x) then
    raise exception 'a player appears more than once';
  end if;

  select coalesce(array_agg(tp.membership_id), '{}') into v_still
    from team_players tp join rsvps r
      on r.match_id = tp.match_id and r.membership_id = tp.membership_id and r.response = 'in'
    where tp.match_id = p_match;
  select count(*) into v_holders from team_players where match_id = p_match;
  if cardinality(v_still) = v_holders then raise exception 'nobody has dropped out'; end if;
  if not (v_still <@ v_new) then raise exception 'the fix removes someone who is still in'; end if;

  v_extras := array(select x from unnest(v_new) x where x <> all (v_still));
  select coalesce(array_agg(membership_id order by waitlist_position), '{}') into v_queue
    from match_rsvps(p_match) where status = 'waitlist';
  if cardinality(v_extras) <> least(v_holders - cardinality(v_still), cardinality(v_queue))
     or (select coalesce(array_agg(x order by x), '{}') from unnest(v_extras) x)
        is distinct from (select coalesce(array_agg(x order by x), '{}')
                          from unnest(v_queue[1:cardinality(v_extras)]) x) then
    raise exception 'every vacated slot must be filled from the waitlist, in order';
  end if;
  if cardinality(v_new) > v_match.capacity then raise exception 'the fix exceeds the match capacity'; end if;

  delete from team_players where match_id = p_match;
  insert into team_players (match_id, membership_id, side)
    select p_match, x, 'A'::team_side from unnest(p_team_a) x
    union all select p_match, x, 'B'::team_side from unnest(p_team_b) x;
  update teams set revision = revision + 1, dismissed_fix_key = null where match_id = p_match;

  delete from memberships m using rsvps r
    where m.guest_match_id = p_match and r.membership_id = m.id and r.response = 'out'
      and not exists (select 1 from team_players tp where tp.membership_id = m.id);
  delete from memberships m
    where m.group_id = v_match.group_id and m.departed
      and not exists (select 1 from rsvps r where r.membership_id = m.id)
      and not exists (select 1 from team_players tp where tp.membership_id = m.id);
end $$;

-- Pin the search_path of every SECURITY DEFINER function, with pg_temp last so a temp object can never
-- shadow a real one. Re-run this when adding SECURITY DEFINER functions.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef and n.nspname in ('public', 'private')
  loop
    execute format('alter function %s set search_path = public, pg_temp', r.fn);
  end loop;
end $$;

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
