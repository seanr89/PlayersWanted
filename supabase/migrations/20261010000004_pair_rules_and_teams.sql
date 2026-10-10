-- Pair rules, happy-in-goal, and draft/published Teams.
-- Draft Teams are visible to admins only. Published Teams are visible to confirmed members;
-- a player with an unconfirmed claim sees only their own side.

create type pair_kind as enum ('together', 'apart');
create type teams_state as enum ('draft', 'published');
create type team_side as enum ('A', 'B');

create table pair_rules (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  a_membership_id uuid not null references memberships (id) on delete cascade,
  b_membership_id uuid not null references memberships (id) on delete cascade,
  kind pair_kind not null,
  check (a_membership_id <> b_membership_id)
);
create unique index pair_rules_unique on pair_rules (
  least(a_membership_id, b_membership_id), greatest(a_membership_id, b_membership_id)
);

create table teams (
  match_id uuid primary key references matches (id) on delete cascade,
  state teams_state not null default 'draft',
  rank int not null default 0, -- position in the generator's ranked list, so "reshuffle" can step to the next
  published_at timestamptz
);

create table team_players (
  match_id uuid not null references matches (id) on delete cascade,
  membership_id uuid not null references memberships (id) on delete cascade,
  side team_side not null,
  primary key (match_id, membership_id)
);

create function is_confirmed_member(p_group uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships
    where group_id = p_group and person_id = current_person_id() and claim = 'confirmed'
  )
$$;

create function my_side(p_match uuid) returns team_side
language sql stable security definer set search_path = public as $$
  select tp.side from team_players tp join memberships m on m.id = tp.membership_id
  where tp.match_id = p_match and m.person_id = current_person_id()
$$;

create function match_group(p_match uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select group_id from matches where id = p_match
$$;

alter table pair_rules enable row level security;
alter table teams enable row level security;
alter table team_players enable row level security;

create policy pair_rules_admins on pair_rules for select using (is_group_admin(group_id));
create policy teams_visible on teams for select using (
  is_group_admin(match_group(match_id)) or (state = 'published' and is_group_member(match_group(match_id)))
);
create policy team_players_visible on team_players for select using (
  is_group_admin(match_group(match_id))
  or (
    exists (select 1 from teams t where t.match_id = team_players.match_id and t.state = 'published')
    and (is_confirmed_member(match_group(match_id)) or side = my_side(match_id))
  )
);

create function set_happy_in_goal(p_membership uuid, p_value boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid; v_person uuid;
begin
  select group_id, person_id into v_group, v_person from memberships where id = p_membership;
  if v_group is null or not (is_group_admin(v_group) or v_person = current_person_id()) then
    raise exception 'not allowed to change this player';
  end if;
  update memberships set happy_in_goal = p_value where id = p_membership;
end $$;

create function set_pair_rule(p_a uuid, p_b uuid, p_kind pair_kind) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid;
begin
  select a.group_id into v_group from memberships a join memberships b on b.group_id = a.group_id
    where a.id = p_a and b.id = p_b;
  if v_group is null or not is_group_admin(v_group) then raise exception 'only an admin can set pair rules'; end if;
  delete from pair_rules
    where least(a_membership_id, b_membership_id) = least(p_a, p_b)
      and greatest(a_membership_id, b_membership_id) = greatest(p_a, p_b);
  insert into pair_rules (group_id, a_membership_id, b_membership_id, kind) values (v_group, p_a, p_b, p_kind);
end $$;

create function remove_pair_rule(p_a uuid, p_b uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid;
begin
  select group_id into v_group from memberships where id = p_a;
  if v_group is null or not is_group_admin(v_group) then raise exception 'only an admin can remove pair rules'; end if;
  delete from pair_rules
    where least(a_membership_id, b_membership_id) = least(p_a, p_b)
      and greatest(a_membership_id, b_membership_id) = greatest(p_a, p_b);
end $$;

-- Saves (or replaces) the draft: the two sides must be exactly the players currently playing.
create function save_draft_teams(p_match uuid, p_team_a uuid[], p_team_b uuid[], p_rank int default 0) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid;
begin
  select group_id into v_group from matches where id = p_match;
  if v_group is null or not is_group_admin(v_group) then raise exception 'only an admin can edit teams'; end if;
  if exists (select 1 from teams where match_id = p_match and state = 'published') then
    raise exception 'published teams cannot be changed without confirming a fix';
  end if;
  if (select coalesce(array_agg(x order by x), '{}') from unnest(p_team_a || p_team_b) x)
     is distinct from (select coalesce(array_agg(membership_id order by membership_id), '{}')
                       from match_rsvps(p_match) where status = 'playing') then
    raise exception 'teams must contain exactly the players who are playing';
  end if;

  insert into teams (match_id, state, rank) values (p_match, 'draft', p_rank)
    on conflict (match_id) do update set rank = excluded.rank;
  delete from team_players where match_id = p_match;
  insert into team_players (match_id, membership_id, side)
    select p_match, x, 'A'::team_side from unnest(p_team_a) x
    union all select p_match, x, 'B'::team_side from unnest(p_team_b) x;
end $$;

create function publish_teams(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid;
begin
  select group_id into v_group from matches where id = p_match;
  if v_group is null or not is_group_admin(v_group) then raise exception 'only an admin can publish teams'; end if;
  update teams set state = 'published', published_at = now() where match_id = p_match and state = 'draft';
  if not found then raise exception 'there is no draft to publish'; end if;
  update matches set status = 'teams_published' where id = p_match;
end $$;

revoke all on pair_rules, teams, team_players from anon, authenticated;
grant select on pair_rules, teams, team_players to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
