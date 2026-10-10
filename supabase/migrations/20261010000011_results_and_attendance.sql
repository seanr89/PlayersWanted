-- Score-only Results, a player's own record, and the Group Attendance board.
-- "Played" means: on the published Teams of a played Match and still RSVPed in. Someone who dropped out
-- and was never replaced does not count. There is deliberately no win-based leaderboard.

create table results (
  match_id uuid primary key references matches (id) on delete cascade,
  score_a int not null check (score_a >= 0),
  score_b int not null check (score_b >= 0),
  recorded_at timestamptz not null default now()
);

alter table results enable row level security;
create policy results_members on results for select using (is_group_member(match_group(match_id)));

-- Recording again corrects a mistyped score.
create function record_result(p_match uuid, p_score_a int, p_score_b int) returns void
language plpgsql security definer set search_path = public as $$
declare v_match matches;
begin
  select * into v_match from matches where id = p_match;
  if not found or not is_group_admin(v_match.group_id) then raise exception 'only an admin can record a result'; end if;
  if v_match.status not in ('teams_published', 'played') then
    raise exception 'a result needs published teams';
  end if;
  insert into results (match_id, score_a, score_b) values (p_match, p_score_a, p_score_b)
    on conflict (match_id) do update set score_a = excluded.score_a, score_b = excluded.score_b, recorded_at = now();
  update matches set status = 'played' where id = p_match;
end $$;

-- One row per member appearance in a played Match.
create view appearances with (security_invoker = false) as
  select m.group_id, m.id as match_id, tp.membership_id, tp.side, r.score_a, r.score_b
  from matches m
  join results r on r.match_id = m.id
  join team_players tp on tp.match_id = m.id
  join rsvps rv on rv.match_id = m.id and rv.membership_id = tp.membership_id and rv.response = 'in'
  where m.status = 'played';
revoke all on appearances from anon, authenticated;

create function my_record(p_group uuid)
returns table (played int, won int, drawn int, lost int, group_matches int)
language sql stable security definer set search_path = public as $$
  with me as (
    select id from memberships
    where group_id = p_group and person_id = current_person_id() and guest_match_id is null
  ),
  mine as (select a.* from appearances a join me on me.id = a.membership_id)
  select
    (select count(*)::int from mine),
    (select count(*)::int from mine where (side = 'A' and score_a > score_b) or (side = 'B' and score_b > score_a)),
    (select count(*)::int from mine where score_a = score_b),
    (select count(*)::int from mine where (side = 'A' and score_a < score_b) or (side = 'B' and score_b < score_a)),
    case when is_group_member(p_group)
      then (select count(*)::int from matches where group_id = p_group and status = 'played') else 0 end
$$;

create function attendance_board(p_group uuid) returns table (membership_id uuid, display_name text, played int)
language sql stable security definer set search_path = public as $$
  select ms.id, ms.display_name, (select count(*)::int from appearances a where a.membership_id = ms.id)
  from memberships ms
  where ms.group_id = p_group and ms.guest_match_id is null and is_group_member(p_group)
  order by 3 desc, ms.display_name
$$;

revoke all on results from anon, authenticated;
grant select on results to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
