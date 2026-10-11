-- Venues: saved per Group, created inline the first time they are typed, reused by Matches.
-- The maps link is only a link (no maps API), and must be a web address so it can never be a script URL.

create table venues (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  address text check (char_length(address) <= 200),
  maps_url text check (char_length(maps_url) <= 500 and maps_url ~* '^https?://'),
  default_cost numeric(6, 2) not null default 0 check (default_cost >= 0),
  created_at timestamptz not null default now()
);
create unique index venues_one_name_per_group on venues (group_id, lower(trim(name)));

alter table matches add column venue_id uuid references venues (id) on delete set null;

alter table venues enable row level security;
create policy venues_members on venues for select using (is_group_member(group_id));

create function check_maps_url(p_url text) returns void
language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if p_url is not null and p_url !~* '^https?://' then
    raise exception 'the maps link must be a web address starting with http:// or https://';
  end if;
end $$;

create function create_venue(
  p_group uuid, p_name text, p_address text default null, p_maps_url text default null, p_default_cost numeric default 0
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if not is_group_admin(p_group) then raise exception 'only an admin can add a venue'; end if;
  perform check_maps_url(p_maps_url);
  insert into venues (group_id, name, address, maps_url, default_cost)
    values (p_group, trim(p_name), p_address, p_maps_url, coalesce(p_default_cost, 0))
    returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'a venue with that name already exists in this group';
end $$;

-- Typing a venue name when setting up a match: use the saved one if it exists, otherwise save it.
create function find_or_create_venue(p_group uuid, p_name text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if not is_group_admin(p_group) then raise exception 'only an admin can add a venue'; end if;
  select id into v_id from venues where group_id = p_group and lower(trim(name)) = lower(trim(p_name));
  if v_id is null then
    insert into venues (group_id, name) values (p_group, trim(p_name)) returning id into v_id;
  end if;
  return v_id;
end $$;

-- Any argument left null keeps its current value.
create function update_venue(
  p_venue uuid, p_name text default null, p_address text default null, p_maps_url text default null,
  p_default_cost numeric default null
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_group uuid;
begin
  select group_id into v_group from venues where id = p_venue;
  if v_group is null or not is_group_admin(v_group) then raise exception 'only an admin can edit a venue'; end if;
  perform check_maps_url(p_maps_url);
  update venues set
    name = coalesce(trim(p_name), name),
    address = coalesce(p_address, address),
    maps_url = coalesce(p_maps_url, maps_url),
    default_cost = coalesce(p_default_cost, default_cost)
  where id = p_venue;
exception when unique_violation then
  raise exception 'a venue with that name already exists in this group';
end $$;

-- A Match takes the Venue's default cost unless a cost is given (an explicit 0 means free).
drop function create_match(uuid, timestamptz, int, numeric, timestamptz);
create function create_match(
  p_group uuid, p_starts_at timestamptz, p_capacity int default 10, p_cost numeric default null,
  p_rsvp_deadline timestamptz default null, p_venue uuid default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_default_cost numeric;
begin
  if not is_group_admin(p_group) then raise exception 'only an admin can create a match'; end if;
  if p_venue is not null then
    select default_cost into v_default_cost from venues where id = p_venue and group_id = p_group;
    if not found then raise exception 'that venue does not belong to this group'; end if;
  end if;
  insert into matches (group_id, starts_at, capacity, cost_per_player, rsvp_deadline, venue_id)
    values (p_group, p_starts_at, p_capacity, coalesce(p_cost, v_default_cost, 0), p_rsvp_deadline, p_venue)
    returning id into v_id;
  return v_id;
end $$;

create function set_match_venue(p_match uuid, p_venue uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_match matches;
begin
  select * into v_match from matches where id = p_match;
  if not found or not is_group_admin(v_match.group_id) then raise exception 'only an admin can edit a match'; end if;
  if v_match.status in ('played', 'cancelled') then raise exception 'a % match cannot be edited', v_match.status; end if;
  if p_venue is not null and not exists (select 1 from venues where id = p_venue and group_id = v_match.group_id) then
    raise exception 'that venue does not belong to this group';
  end if;
  update matches set venue_id = p_venue where id = p_match;
end $$;

revoke all on venues from anon, authenticated;
grant select on venues to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
