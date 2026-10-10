-- Fixes from review of guests and the minimal-change fix:
-- NULL arrays wiping published Teams, guest removal after the match, skipping the Waitlist,
-- unlimited guests, cross-match guest RSVPs, and lingering removed guests.

-- Per-member cap so one person cannot bury everyone else on the Waitlist.
create or replace function add_guest(p_match uuid, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_match matches; v_sponsor uuid; v_guest uuid;
begin
  select * into v_match from matches where id = p_match;
  if not found or not is_group_member(v_match.group_id) then raise exception 'match not found'; end if;
  if v_match.status not in ('rsvps_open', 'teams_published') then
    raise exception 'RSVPs are not open for this match';
  end if;
  select id into v_sponsor from memberships
    where group_id = v_match.group_id and person_id = current_person_id() and guest_match_id is null;
  if (select count(*) from memberships where guest_match_id = p_match and sponsor_membership_id = v_sponsor) >= 3 then
    raise exception 'guest limit reached: a member can bring at most 3 guests to a match';
  end if;
  insert into memberships (group_id, display_name, claim, guest_match_id, sponsor_membership_id)
    values (v_match.group_id, trim(p_name), 'confirmed', p_match, v_sponsor)
    returning id into v_guest;
  insert into rsvps (match_id, membership_id, response) values (p_match, v_guest, 'in');
  return v_guest;
end $$;

-- Guests can only be removed while the match is still being organised: deleting one afterwards would
-- erase Team and attendance history.
create or replace function remove_guest(p_guest uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_guest memberships; v_status match_status;
begin
  select * into v_guest from memberships where id = p_guest;
  if not found or v_guest.guest_match_id is null then raise exception 'that is not a guest'; end if;
  if not (is_group_admin(v_guest.group_id) or exists (
        select 1 from memberships s
        where s.id = v_guest.sponsor_membership_id and s.person_id = current_person_id())) then
    raise exception 'not allowed to remove this guest';
  end if;
  select status into v_status from matches where id = v_guest.guest_match_id;
  if v_status not in ('rsvps_open', 'teams_published') then
    raise exception 'this guest can no longer be removed: the match is not open';
  end if;
  if v_status = 'teams_published' then
    update rsvps set response = 'out', responded_at = clock_timestamp()
      where membership_id = p_guest and match_id = v_guest.guest_match_id;
  else
    delete from memberships where id = p_guest;
  end if;
end $$;

-- An admin acting on someone's behalf cannot pick a Guest that belongs to a different match.
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
      where group_id = v_match.group_id and person_id = current_person_id();
  else
    if not is_group_admin(v_match.group_id) then raise exception 'only an admin can RSVP for someone else'; end if;
    select id into v_target from memberships
      where id = p_membership and group_id = v_match.group_id
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

create or replace function dismiss_fix(p_match uuid, p_key text) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid;
begin
  select group_id into v_group from matches where id = p_match and status = 'teams_published';
  if v_group is null or not is_group_admin(v_group) then raise exception 'only an admin can dismiss a fix'; end if;
  if p_key is null or length(p_key) > 500 then raise exception 'invalid fix key'; end if;
  update teams set dismissed_fix_key = p_key where match_id = p_match;
end $$;

-- NULL or empty lists used to slip through (`not (x <@ NULL)` is NULL, not true) and wipe the Teams.
-- Every vacated slot must now be filled from the Waitlist in order, as far as the Waitlist reaches.
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

  -- Guests who dropped out have served their purpose: no lingering rows.
  delete from memberships m using rsvps r
    where m.guest_match_id = p_match and r.membership_id = m.id and r.response = 'out'
      and not exists (select 1 from team_players tp where tp.membership_id = m.id);
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
