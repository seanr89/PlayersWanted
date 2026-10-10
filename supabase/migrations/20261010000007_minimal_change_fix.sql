-- The minimal-change fix. The app proposes it (computed, never stored); only confirm_fix changes
-- published Teams, and it re-validates everything so a tampered proposal cannot skip the Waitlist.

alter table teams
  add column revision int not null default 0, -- bumped on each confirmed change, so players can be notified
  add column dismissed_fix_key text;

create function confirm_fix(p_match uuid, p_team_a uuid[], p_team_b uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_match matches;
  v_new uuid[] := p_team_a || p_team_b;
  v_still uuid[];
  v_holders int;
  v_extras uuid[];
  v_queue uuid[];
begin
  select * into v_match from matches where id = p_match;
  if not found or not is_group_admin(v_match.group_id) then raise exception 'only an admin can confirm a fix'; end if;
  if v_match.status <> 'teams_published' then raise exception 'there are no published teams to fix'; end if;
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

  -- Anyone added must be the next people in the queue, in order.
  v_extras := array(select x from unnest(v_new) x where x <> all (v_still));
  select coalesce(array_agg(membership_id order by waitlist_position), '{}') into v_queue
    from match_rsvps(p_match) where status = 'waitlist';
  if cardinality(v_extras) > cardinality(v_queue)
     or (select coalesce(array_agg(x order by x), '{}') from unnest(v_extras) x)
        is distinct from (select coalesce(array_agg(x order by x), '{}')
                          from unnest(v_queue[1:cardinality(v_extras)]) x) then
    raise exception 'promotions must follow the waitlist order';
  end if;
  if cardinality(v_new) > v_match.capacity then raise exception 'the fix exceeds the match capacity'; end if;

  delete from team_players where match_id = p_match;
  insert into team_players (match_id, membership_id, side)
    select p_match, x, 'A'::team_side from unnest(p_team_a) x
    union all select p_match, x, 'B'::team_side from unnest(p_team_b) x;
  update teams set revision = revision + 1, dismissed_fix_key = null where match_id = p_match;
end $$;

create function dismiss_fix(p_match uuid, p_key text) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid;
begin
  select group_id into v_group from matches where id = p_match and status = 'teams_published';
  if v_group is null or not is_group_admin(v_group) then raise exception 'only an admin can dismiss a fix'; end if;
  update teams set dismissed_fix_key = p_key where match_id = p_match;
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
