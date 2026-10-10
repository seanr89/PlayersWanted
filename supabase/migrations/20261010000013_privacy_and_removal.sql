-- Removing a Membership, leaving a Group and deleting an account.
--
-- Deleting a Membership row would cascade away past appearances and corrupt Results and attendance. So the
-- row is anonymised instead: no person link, name, Rating, position or pair rules, and its RSVPs and team
-- slots for matches still to come are cleared. What remains is a "Former player" placeholder that keeps
-- played history intact. A placeholder with nothing left to preserve is deleted outright.

alter table memberships add column departed boolean not null default false;

-- A Guest outlives its sponsor leaving, so the sponsor link must not cascade.
alter table memberships drop constraint guest_has_sponsor;
alter table memberships drop constraint memberships_sponsor_membership_id_fkey;
alter table memberships
  add constraint memberships_sponsor_membership_id_fkey
    foreign key (sponsor_membership_id) references memberships (id) on delete set null,
  add constraint only_guests_have_sponsors check (guest_match_id is not null or sponsor_membership_id is null);

-- Internal helpers live outside `public` so the API never exposes them.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create function private.anonymise_membership(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_guest boolean;
begin
  select guest_match_id is not null into v_guest from memberships where id = p_id;
  update memberships set
    display_name = case when v_guest then 'Former guest' else 'Former player' end,
    person_id = null, departed = true, claim = 'confirmed', position = null, happy_in_goal = false
  where id = p_id;
  delete from membership_ratings where membership_id = p_id;
  delete from pair_rules where a_membership_id = p_id or b_membership_id = p_id;
  delete from rsvps r using matches m
    where r.membership_id = p_id and m.id = r.match_id
      and m.status in ('scheduled', 'rsvps_open', 'teams_published', 'cancelled');
  -- Published Teams keep the slot, so the minimal-change fix sees a vacated place.
  delete from team_players tp using matches m
    where tp.membership_id = p_id and m.id = tp.match_id and m.status in ('scheduled', 'rsvps_open', 'cancelled');
  delete from memberships
    where id = p_id
      and not exists (select 1 from rsvps where membership_id = p_id)
      and not exists (select 1 from team_players where membership_id = p_id);
end $$;

-- A member and the Guests they brought go together.
create function private.depart(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_guest uuid;
begin
  for v_guest in select id from memberships where sponsor_membership_id = p_id loop
    perform private.anonymise_membership(v_guest);
  end loop;
  update memberships set sponsor_membership_id = null where sponsor_membership_id = p_id;
  perform private.anonymise_membership(p_id);
end $$;

create function remove_membership(p_membership uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_target memberships;
begin
  select * into v_target from memberships where id = p_membership;
  if not found or not is_group_admin(v_target.group_id) then
    raise exception 'only an admin can remove a member';
  end if;
  if v_target.role = 'owner' then raise exception 'the owner cannot be removed'; end if;
  if v_target.guest_match_id is not null or v_target.departed then
    raise exception 'that is not a current member (guests are removed with remove_guest)';
  end if;
  perform private.depart(p_membership);
end $$;

create function leave_group(p_group uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_me memberships;
begin
  select * into v_me from memberships
    where group_id = p_group and person_id = current_person_id() and guest_match_id is null and not departed;
  if not found then raise exception 'you are not a member of this group'; end if;
  if v_me.role = 'owner' then
    raise exception 'the owner must transfer ownership or delete the group before leaving';
  end if;
  perform private.depart(v_me.id);
end $$;

-- Erases the Person and anonymises their history in every Group. An Owner of a Group with other members
-- must hand it over first; an Owner who is the only member takes the Group with them.
create function delete_account() returns void
language plpgsql security definer set search_path = public as $$
declare v_person uuid := current_person_id(); v_m memberships; v_solo uuid[] := '{}';
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  for v_m in select * from memberships where person_id = v_person and guest_match_id is null and not departed loop
    if v_m.role = 'owner' then
      if exists (select 1 from memberships o
                 where o.group_id = v_m.group_id and o.id <> v_m.id and o.guest_match_id is null
                   and o.person_id is not null and not o.departed) then
        raise exception 'transfer ownership of your groups before deleting your account';
      end if;
      v_solo := v_solo || v_m.group_id;
    end if;
  end loop;

  delete from groups where id = any (v_solo);
  for v_m in select * from memberships where person_id = v_person and guest_match_id is null loop
    perform private.depart(v_m.id);
  end loop;
  delete from person where id = v_person;
  delete from auth.users where id = auth.uid();
end $$;

-- Every Group must always have an Owner, whichever route changes its memberships. Checked at commit so
-- ownership transfer and Group creation can pass through intermediate states.
create function check_group_has_owner() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_group uuid := coalesce(new.group_id, old.group_id);
begin
  if exists (select 1 from groups where id = v_group)
     and not exists (select 1 from memberships where group_id = v_group and role = 'owner' and not departed) then
    raise exception 'a group must always have an owner';
  end if;
  return null;
end $$;
create constraint trigger memberships_have_owner
  after insert or update or delete on memberships
  deferrable initially deferred
  for each row execute function check_group_has_owner();

-- Departed placeholders are not people: they cannot be rated, paired, RSVPed for or shown to anyone.
create or replace function get_invite(p_token text) returns jsonb
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
      from memberships where group_id = v_group.id and claim = 'ghost' and not departed
    ), '[]'::jsonb)
  );
end $$;

create or replace function set_rating(p_membership uuid, p_rating int) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid; v_departed boolean;
begin
  select group_id, departed into v_group, v_departed from memberships where id = p_membership;
  if v_group is null or v_departed or not is_group_admin(v_group) then
    raise exception 'only an admin can set a rating';
  end if;
  insert into membership_ratings (membership_id, rating) values (p_membership, p_rating)
    on conflict (membership_id) do update set rating = excluded.rating;
end $$;

create or replace function set_pair_rule(p_a uuid, p_b uuid, p_kind pair_kind) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid;
begin
  select a.group_id into v_group from memberships a join memberships b on b.group_id = a.group_id
    where a.id = p_a and b.id = p_b and not a.departed and not b.departed;
  if v_group is null or not is_group_admin(v_group) then raise exception 'only an admin can set pair rules'; end if;
  delete from pair_rules
    where least(a_membership_id, b_membership_id) = least(p_a, p_b)
      and greatest(a_membership_id, b_membership_id) = greatest(p_a, p_b);
  insert into pair_rules (group_id, a_membership_id, b_membership_id, kind) values (v_group, p_a, p_b, p_kind);
end $$;

create or replace function set_rsvp(p_match uuid, p_response rsvp_response, p_membership uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_match matches;
  v_target uuid;
  v_existing rsvps;
begin
  select * into v_match from matches where id = p_match;
  if not found or not is_group_member(v_match.group_id) then raise exception 'match not found'; end if;
  if v_match.status not in ('rsvps_open', 'teams_published') then
    raise exception 'RSVPs are not open for this match';
  end if;

  if p_membership is null then
    select id into v_target from memberships
      where group_id = v_match.group_id and person_id = current_person_id() and not departed;
  else
    if not is_group_admin(v_match.group_id) then raise exception 'only an admin can RSVP for someone else'; end if;
    select id into v_target from memberships
      where id = p_membership and group_id = v_match.group_id and not departed
        and (guest_match_id is null or guest_match_id = p_match);
    if v_target is null then raise exception 'that player is not in this group'; end if;
  end if;

  select * into v_existing from rsvps where match_id = p_match and membership_id = v_target;
  if not found then
    insert into rsvps (match_id, membership_id, response) values (p_match, v_target, p_response);
  elsif v_existing.response <> p_response then
    update rsvps set
      response = p_response,
      responded_at = clock_timestamp(),
      late_dropout = (p_response = 'out' and v_match.rsvp_deadline is not null and now() > v_match.rsvp_deadline)
    where id = v_existing.id;
  end if; -- repeating the same answer keeps your place in the queue
end $$;

create or replace function attendance_board(p_group uuid) returns table (membership_id uuid, display_name text, played int)
language sql stable security definer set search_path = public as $$
  select ms.id, ms.display_name, (select count(*)::int from appearances a where a.membership_id = ms.id)
  from memberships ms
  where ms.group_id = p_group and ms.guest_match_id is null and not ms.departed and is_group_member(p_group)
  order by 3 desc, ms.display_name
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
