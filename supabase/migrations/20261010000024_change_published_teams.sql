-- An Admin rearranging published Teams (spec: "any change to Teams (swap, reshuffle, fix) requires an explicit Admin
-- action. Each confirmed change notifies players"). Only the same players change sides: adding or removing someone
-- is the dropout fix's job (confirm_fix), which also has to follow the Waitlist.

create function change_published_teams(p_match uuid, p_team_a uuid[], p_team_b uuid[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_match matches;
  v_new uuid[];
  v_current uuid[];
  v_still int;
  v_unchanged boolean;
begin
  select * into v_match from matches where id = p_match;
  if not found or not is_group_admin(v_match.group_id) then raise exception 'only an admin can change the teams'; end if;
  if v_match.status <> 'teams_published' then raise exception 'there are no published teams to change'; end if;
  if p_team_a is null or p_team_b is null then raise exception 'a change must list both teams'; end if;
  if cardinality(p_team_a) = 0 or cardinality(p_team_b) = 0 then raise exception 'each team needs at least one player'; end if;
  v_new := p_team_a || p_team_b;
  if array_position(v_new, null) is not null then raise exception 'a change must list the players on each team'; end if;
  if cardinality(v_new) <> (select count(distinct x) from unnest(v_new) x) then
    raise exception 'a player appears more than once';
  end if;

  select coalesce(array_agg(membership_id order by membership_id), '{}') into v_current
    from team_players where match_id = p_match;
  if (select coalesce(array_agg(x order by x), '{}') from unnest(v_new) x) is distinct from v_current then
    raise exception 'a change must keep exactly the players already on the teams';
  end if;

  -- Someone who dropped out is still listed: the fix (which follows the Waitlist) has to come first.
  select count(*) into v_still from team_players tp join rsvps r
    on r.match_id = tp.match_id and r.membership_id = tp.membership_id and r.response = 'in'
    where tp.match_id = p_match;
  if v_still <> cardinality(v_current) then raise exception 'someone has dropped out: confirm the fix first'; end if;

  select not exists (
    select 1 from team_players tp
    where tp.match_id = p_match
      and tp.side <> (case when tp.membership_id = any (p_team_a) then 'A' else 'B' end)::team_side
  ) into v_unchanged;
  if v_unchanged then raise exception 'there is nothing to change'; end if;

  delete from team_players where match_id = p_match;
  insert into team_players (match_id, membership_id, side)
    select p_match, x, 'A'::team_side from unnest(p_team_a) x
    union all select p_match, x, 'B'::team_side from unnest(p_team_b) x;
  update teams set revision = revision + 1, dismissed_fix_key = null where match_id = p_match;
  perform private.emit_notification('teams_changed', v_match.group_id, p_match,
    jsonb_build_object('revision', (select revision from teams where match_id = p_match), 'reason', 'organiser_change'));
end $$;

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
-- Service-role-only function: undo the blanket grant (it also checks the role itself).
revoke execute on function claim_pending_notifications(int) from public, anon, authenticated;
grant execute on function claim_pending_notifications(int) to service_role;
