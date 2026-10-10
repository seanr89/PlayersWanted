-- Fixes from review: happy-in-goal permission hole, frozen Waitlist after publishing,
-- draft/publish lifecycle checks, position tags, invite regeneration, rejected claims, name limits.

alter table person add constraint person_name_length check (char_length(name) <= 80);
alter table groups add constraint groups_name_length check (char_length(name) <= 80);
alter table memberships add constraint memberships_name_length check (char_length(display_name) <= 80);

-- A ghost has no person, so `v_person = current_person_id()` was NULL for strangers and the guard was skipped.
create or replace function set_happy_in_goal(p_membership uuid, p_value boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid; v_person uuid;
begin
  select group_id, person_id into v_group, v_person from memberships where id = p_membership;
  if v_group is null
     or not (is_group_admin(v_group) or (v_person is not null and v_person = current_person_id())) then
    raise exception 'not allowed to change this player';
  end if;
  update memberships set happy_in_goal = p_value where id = p_membership;
end $$;

create function set_position(p_membership uuid, p_position position_tag default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid;
begin
  select group_id into v_group from memberships where id = p_membership;
  if v_group is null or not is_group_admin(v_group) then raise exception 'only an admin can set a position'; end if;
  update memberships set position = p_position where id = p_membership;
end $$;

create function regenerate_invite(p_group uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  if not is_group_admin(p_group) then raise exception 'only an admin can regenerate the invite link'; end if;
  update groups set invite_token = encode(extensions.gen_random_bytes(12), 'hex') where id = p_group
    returning invite_token into v_token;
  return v_token;
end $$;

-- A rejected claimant's RSVPs and flags must not linger on the ghost profile.
create or replace function reject_claim(p_membership uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid;
begin
  select group_id into v_group from memberships where id = p_membership and claim = 'pending';
  if v_group is null or not is_group_admin(v_group) then
    raise exception 'only an admin can reject a pending claim';
  end if;
  delete from rsvps where membership_id = p_membership;
  update memberships set person_id = null, claim = 'ghost', happy_in_goal = false where id = p_membership;
end $$;

-- Once Teams are published, only players already on a Team keep a playing place: nobody is
-- promoted off the Waitlist until an admin confirms a fix. A dropout can still reclaim their own place.
create or replace function match_rsvps(p_match uuid) returns table (
  membership_id uuid, display_name text, response text, status text,
  waitlist_position int, late_dropout boolean
)
language sql stable security definer set search_path = public as $$
  with m as (select * from matches where id = p_match and is_group_member(group_id)),
  base as (
    select r.*, m.capacity, m.group_id, m.status as match_status,
      row_number() over (partition by r.response order by r.responded_at, r.id) as n_response
    from rsvps r join m on m.id = r.match_id
  ),
  flagged as (
    select b.*, (
      b.response = 'in' and case
        when b.match_status = 'teams_published' then exists (
          select 1 from team_players tp where tp.match_id = b.match_id and tp.membership_id = b.membership_id)
        else b.n_response <= b.capacity
      end
    ) as is_playing
    from base b
  )
  select ms.id, ms.display_name, f.response::text,
    case when f.response = 'out' then 'out' when f.is_playing then 'playing' else 'waitlist' end,
    case when f.response = 'in' and not f.is_playing then (
      select count(*)::int from flagged x
      where x.response = 'in' and not x.is_playing and (x.responded_at, x.id) <= (f.responded_at, f.id)
    ) end,
    case when is_group_admin(f.group_id) then f.late_dropout end
  from flagged f join memberships ms on ms.id = f.membership_id
  order by (f.response = 'out'), (not f.is_playing), f.responded_at, f.id
$$;

create function draft_matches_playing(p_match uuid, p_team_a uuid[], p_team_b uuid[]) returns boolean
language sql stable security definer set search_path = public as $$
  select cardinality(p_team_a || p_team_b) >= 2
    and (select coalesce(array_agg(x order by x), '{}') from unnest(p_team_a || p_team_b) x)
        is not distinct from (select coalesce(array_agg(membership_id order by membership_id), '{}')
                              from match_rsvps(p_match) where status = 'playing')
$$;

create or replace function save_draft_teams(p_match uuid, p_team_a uuid[], p_team_b uuid[], p_rank int default 0) returns void
language plpgsql security definer set search_path = public as $$
declare v_match matches;
begin
  select * into v_match from matches where id = p_match;
  if not found or not is_group_admin(v_match.group_id) then raise exception 'only an admin can edit teams'; end if;
  if v_match.status <> 'rsvps_open' then
    raise exception 'teams can only be drafted while RSVPs are open (published teams cannot change without a confirmed fix)';
  end if;
  if not draft_matches_playing(p_match, p_team_a, p_team_b) then
    raise exception 'teams must contain exactly the players who are playing';
  end if;

  insert into teams (match_id, state, rank) values (p_match, 'draft', p_rank)
    on conflict (match_id) do update set rank = excluded.rank;
  delete from team_players where match_id = p_match;
  insert into team_players (match_id, membership_id, side)
    select p_match, x, 'A'::team_side from unnest(p_team_a) x
    union all select p_match, x, 'B'::team_side from unnest(p_team_b) x;
end $$;

create or replace function publish_teams(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_match matches;
begin
  select * into v_match from matches where id = p_match;
  if not found or not is_group_admin(v_match.group_id) then raise exception 'only an admin can publish teams'; end if;
  if v_match.status <> 'rsvps_open' then raise exception 'teams can only be published while RSVPs are open'; end if;
  if not exists (select 1 from teams where match_id = p_match and state = 'draft') then
    raise exception 'there is no draft to publish';
  end if;
  if not draft_matches_playing(
       p_match,
       (select coalesce(array_agg(membership_id), '{}') from team_players where match_id = p_match and side = 'A'),
       (select coalesce(array_agg(membership_id), '{}') from team_players where match_id = p_match and side = 'B')) then
    raise exception 'the draft is out of date: regenerate it before publishing';
  end if;
  update teams set state = 'published', published_at = now() where match_id = p_match;
  update matches set status = 'teams_published' where id = p_match;
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
