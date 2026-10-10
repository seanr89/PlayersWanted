-- Matches, RSVPs, Capacity and the Waitlist.
-- The Waitlist is derived, not stored: in-RSVPs ordered by response time, first `capacity` play.
-- That makes promotion automatic and impossible to get out of sync.

create type match_status as enum ('scheduled', 'rsvps_open', 'teams_published', 'played', 'cancelled');
create type rsvp_response as enum ('in', 'out');

create table matches (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  starts_at timestamptz not null,
  capacity int not null default 10 check (capacity > 0),
  cost_per_player numeric(6, 2) not null default 0 check (cost_per_player >= 0),
  rsvp_deadline timestamptz,
  status match_status not null default 'scheduled',
  created_at timestamptz not null default now()
);
create index matches_group on matches (group_id, starts_at);

create table rsvps (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches (id) on delete cascade,
  membership_id uuid not null references memberships (id) on delete cascade,
  response rsvp_response not null,
  responded_at timestamptz not null default clock_timestamp(),
  late_dropout boolean not null default false,
  unique (match_id, membership_id)
);

alter table matches enable row level security;
alter table rsvps enable row level security;

create policy matches_members on matches for select using (is_group_member(group_id));
-- late_dropout is admin-only, so players read RSVPs through match_rsvps() rather than the table.
create policy rsvps_admins on rsvps for select
  using (is_group_admin((select group_id from matches m where m.id = match_id)));

create function create_match(
  p_group uuid, p_starts_at timestamptz, p_capacity int default 10,
  p_cost numeric default 0, p_rsvp_deadline timestamptz default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_group_admin(p_group) then raise exception 'only an admin can create a match'; end if;
  insert into matches (group_id, starts_at, capacity, cost_per_player, rsvp_deadline)
    values (p_group, p_starts_at, p_capacity, p_cost, p_rsvp_deadline)
    returning id into v_id;
  return v_id;
end $$;

create function open_rsvps(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid;
begin
  select group_id into v_group from matches where id = p_match and status = 'scheduled';
  if v_group is null or not is_group_admin(v_group) then
    raise exception 'only an admin can open RSVPs on a scheduled match';
  end if;
  update matches set status = 'rsvps_open' where id = p_match;
end $$;

-- Set in/out for yourself, or (admins only) on behalf of another Membership.
create function set_rsvp(p_match uuid, p_response rsvp_response, p_membership uuid default null) returns void
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
    select id into v_target from memberships where id = p_membership and group_id = v_match.group_id;
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

create function match_rsvps(p_match uuid) returns table (
  membership_id uuid, display_name text, response text, status text,
  waitlist_position int, late_dropout boolean
)
language sql stable security definer set search_path = public as $$
  with m as (select * from matches where id = p_match and is_group_member(group_id)),
  ranked as (
    select r.*, row_number() over (partition by r.response order by r.responded_at, r.id) as n
    from rsvps r where r.match_id = p_match
  )
  select ms.id, ms.display_name, r.response::text,
    case when r.response = 'out' then 'out' when r.n <= m.capacity then 'playing' else 'waitlist' end,
    case when r.response = 'in' and r.n > m.capacity then (r.n - m.capacity)::int end,
    case when is_group_admin(m.group_id) then r.late_dropout end
  from m join ranked r on true join memberships ms on ms.id = r.membership_id
  order by (r.response = 'out'), r.n
$$;

revoke all on matches, rsvps from anon, authenticated;
grant select on matches to authenticated;
grant select on rsvps to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
