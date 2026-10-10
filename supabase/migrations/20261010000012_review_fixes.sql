-- Fixes from review of roles, match management and results.

-- A wrong claimant's RSVPs for matches still to be played are undone, but a ghost profile's played
-- history (and so the Attendance board) must survive a rejected claim.
create or replace function reject_claim(p_membership uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid;
begin
  select group_id into v_group from memberships where id = p_membership and claim = 'pending';
  if v_group is null or not is_group_admin(v_group) then
    raise exception 'only an admin can reject a pending claim';
  end if;
  delete from rsvps r using matches m
    where r.membership_id = p_membership and m.id = r.match_id
      and m.status in ('scheduled', 'rsvps_open', 'teams_published');
  update memberships set person_id = null, claim = 'ghost', happy_in_goal = false where id = p_membership;
end $$;

-- A pending claimant has not been confirmed yet, so they must not see the profile's record.
-- groupMatches counts Matches made since you were added, so newcomers are not penalised.
create or replace function my_record(p_group uuid)
returns table (played int, won int, drawn int, lost int, group_matches int)
language sql stable security definer set search_path = public as $$
  with me as (
    select id, created_at from memberships
    where group_id = p_group and person_id = current_person_id()
      and guest_match_id is null and claim = 'confirmed'
  ),
  mine as (select a.* from appearances a join me on me.id = a.membership_id)
  select
    (select count(*)::int from mine),
    (select count(*)::int from mine where (side = 'A' and score_a > score_b) or (side = 'B' and score_b > score_a)),
    (select count(*)::int from mine where score_a = score_b),
    (select count(*)::int from mine where (side = 'A' and score_a < score_b) or (side = 'B' and score_b < score_a)),
    (select count(*)::int from matches m, me
      where m.group_id = p_group and m.status = 'played' and m.created_at >= me.created_at)
$$;

-- `p_clear_deadline` removes the deadline; leaving it false keeps the current one.
drop function update_match(uuid, timestamptz, int, numeric, timestamptz);
create function update_match(
  p_match uuid, p_starts_at timestamptz default null, p_capacity int default null,
  p_cost numeric default null, p_rsvp_deadline timestamptz default null, p_clear_deadline boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare v_match matches;
begin
  select * into v_match from matches where id = p_match;
  if not found or not is_group_admin(v_match.group_id) then raise exception 'only an admin can edit a match'; end if;
  if v_match.status in ('played', 'cancelled') then
    raise exception 'a % match cannot be edited', v_match.status;
  end if;
  if p_capacity is not null and p_capacity <> v_match.capacity and v_match.status = 'teams_published' then
    raise exception 'capacity cannot change after teams are published';
  end if;
  update matches set
    starts_at = coalesce(p_starts_at, starts_at),
    capacity = coalesce(p_capacity, capacity),
    cost_per_player = coalesce(p_cost, cost_per_player),
    rsvp_deadline = case when p_clear_deadline then null else coalesce(p_rsvp_deadline, rsvp_deadline) end
  where id = p_match;
end $$;

-- A Result needs a Match that has started, and any dropout must be dealt with first (fix confirmed or
-- dismissed), otherwise the person who really played would silently get no appearance.
create or replace function record_result(p_match uuid, p_score_a int, p_score_b int) returns void
language plpgsql security definer set search_path = public as $$
declare v_match matches;
begin
  select * into v_match from matches where id = p_match;
  if not found or not is_group_admin(v_match.group_id) then raise exception 'only an admin can record a result'; end if;
  if v_match.status not in ('teams_published', 'played') then
    raise exception 'a result needs published teams';
  end if;
  if v_match.starts_at > now() then raise exception 'a result cannot be recorded before the match has started'; end if;
  if exists (
       select 1 from team_players tp
       left join rsvps r on r.match_id = tp.match_id and r.membership_id = tp.membership_id and r.response = 'in'
       where tp.match_id = p_match and r.id is null)
     and (select dismissed_fix_key from teams where match_id = p_match) is null then
    raise exception 'someone has dropped out: confirm or dismiss the proposed fix before recording the result';
  end if;
  insert into results (match_id, score_a, score_b) values (p_match, p_score_a, p_score_b)
    on conflict (match_id) do update set score_a = excluded.score_a, score_b = excluded.score_b, recorded_at = now();
  update matches set status = 'played' where id = p_match;
end $$;

-- Lock the group row first so concurrent role changes by the Owner cannot interleave and leave the
-- Group without an Owner.
create or replace function promote_admin(p_membership uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid; v_target memberships;
begin
  select group_id into v_group from memberships where id = p_membership;
  perform 1 from groups where id = v_group for update;
  select * into v_target from memberships where id = p_membership;
  if not found or not is_group_owner(v_target.group_id) then
    raise exception 'only the owner can change who is an admin';
  end if;
  if v_target.role <> 'member' then raise exception 'only a regular member can be promoted'; end if;
  if v_target.person_id is null or v_target.claim <> 'confirmed' or v_target.guest_match_id is not null then
    raise exception 'only confirmed members can become admins';
  end if;
  update memberships set role = 'admin' where id = p_membership and role = 'member';
end $$;

create or replace function demote_admin(p_membership uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid; v_target memberships;
begin
  select group_id into v_group from memberships where id = p_membership;
  perform 1 from groups where id = v_group for update;
  select * into v_target from memberships where id = p_membership;
  if not found or not is_group_owner(v_target.group_id) then
    raise exception 'only the owner can change who is an admin';
  end if;
  if v_target.role <> 'admin' then raise exception 'only admins can be demoted'; end if;
  update memberships set role = 'member' where id = p_membership and role = 'admin';
end $$;

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
  if v_target.role <> 'admin' then raise exception 'ownership can only be transferred to an admin'; end if;
  select id into v_owner from memberships where group_id = v_target.group_id and role = 'owner';
  update memberships set role = 'admin' where id = v_owner and role = 'owner';
  update memberships set role = 'owner' where id = p_to and role = 'admin';
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
