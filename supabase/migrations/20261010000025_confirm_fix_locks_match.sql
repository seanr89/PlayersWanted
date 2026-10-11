-- confirm_fix and change_published_teams (migration 024) both rewrite team_players after validating it. Without a lock
-- on the match, one that validated against the old players could overwrite the other's result (bringing a dropout
-- back, or losing the promoted Waitlist player). The only change from migration 018 is `for update` on the match row.

CREATE OR REPLACE FUNCTION public.confirm_fix(p_match uuid, p_team_a uuid[], p_team_b uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_match matches;
  v_new uuid[];
  v_still uuid[];
  v_holders int;
  v_extras uuid[];
  v_queue uuid[];
begin
  select * into v_match from matches where id = p_match for update;
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
  perform private.emit_notification('teams_changed', v_match.group_id, p_match,
    jsonb_build_object('revision', (select revision from teams where match_id = p_match)));

  delete from memberships m using rsvps r
    where m.guest_match_id = p_match and r.membership_id = m.id and r.response = 'out'
      and not exists (select 1 from team_players tp where tp.membership_id = m.id);
  delete from memberships m
    where m.group_id = v_match.group_id and m.departed
      and not exists (select 1 from rsvps r where r.membership_id = m.id)
      and not exists (select 1 from team_players tp where tp.membership_id = m.id);
end $function$;
