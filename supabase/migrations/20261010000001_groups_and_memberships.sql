-- Groups, people and memberships.
-- Ratings live in their own table so that "admin-only" is enforced by row-level security,
-- not just by what the UI chooses to show. All writes go through the functions below.

create type member_role as enum ('owner', 'admin', 'member');
create type claim_state as enum ('ghost', 'pending', 'confirmed');
create type position_tag as enum ('GK', 'defender', 'attacker');

create table person (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  name text not null,
  created_at timestamptz not null default now()
);

create table groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  invite_token text not null unique default encode(gen_random_bytes(12), 'hex'),
  min_players int not null default 8 check (min_players > 0),
  show_team_strength boolean not null default false,
  created_at timestamptz not null default now()
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  person_id uuid references person (id) on delete set null, -- null while a ghost profile is unclaimed
  display_name text not null check (length(trim(display_name)) > 0),
  role member_role not null default 'member',
  claim claim_state not null default 'confirmed',
  position position_tag,
  happy_in_goal boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index memberships_one_per_person on memberships (group_id, person_id) where person_id is not null;
create index memberships_group on memberships (group_id);

create table membership_ratings (
  membership_id uuid primary key references memberships (id) on delete cascade,
  rating int not null default 50 check (rating between 1 and 100)
);

-- ---------------------------------------------------------------------------
-- Helpers used by policies and functions (security definer so policies don't recurse)
-- ---------------------------------------------------------------------------

create function current_person_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from person where auth_user_id = auth.uid()
$$;

create function ensure_person(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select id into v_id from person where auth_user_id = auth.uid();
  if v_id is null then
    insert into person (auth_user_id, name) values (auth.uid(), trim(p_name)) returning id into v_id;
  end if;
  return v_id;
end $$;

create function is_group_member(p_group uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships where group_id = p_group and person_id = current_person_id()
  )
$$;

create function is_group_admin(p_group uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships
    where group_id = p_group and person_id = current_person_id() and role in ('owner', 'admin')
  )
$$;

-- ---------------------------------------------------------------------------
-- Row-level security: read-only for signed-in users; Ratings are admin-only.
-- ---------------------------------------------------------------------------

alter table person enable row level security;
alter table groups enable row level security;
alter table memberships enable row level security;
alter table membership_ratings enable row level security;

create policy person_self on person for select using (auth_user_id = auth.uid());
create policy groups_members on groups for select using (is_group_member(id));
create policy memberships_members on memberships for select using (is_group_member(group_id));
create policy ratings_admins on membership_ratings for select
  using (is_group_admin((select group_id from memberships m where m.id = membership_id)));

-- ---------------------------------------------------------------------------
-- Commands
-- ---------------------------------------------------------------------------

create function create_group(p_name text, p_owner_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_person uuid; v_group uuid; v_membership uuid;
begin
  v_person := ensure_person(p_owner_name);
  insert into groups (name) values (trim(p_name)) returning id into v_group;
  insert into memberships (group_id, person_id, display_name, role, claim)
    values (v_group, v_person, trim(p_owner_name), 'owner', 'confirmed')
    returning id into v_membership;
  insert into membership_ratings (membership_id) values (v_membership);
  return v_group;
end $$;

create function add_ghost(p_group uuid, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_membership uuid;
begin
  if not is_group_admin(p_group) then raise exception 'only an admin can add players'; end if;
  insert into memberships (group_id, display_name, claim) values (p_group, trim(p_name), 'ghost')
    returning id into v_membership;
  insert into membership_ratings (membership_id) values (v_membership);
  return v_membership;
end $$;

create function set_rating(p_membership uuid, p_rating int) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid;
begin
  select group_id into v_group from memberships where id = p_membership;
  if v_group is null or not is_group_admin(v_group) then
    raise exception 'only an admin can set a rating';
  end if;
  update membership_ratings set rating = p_rating where membership_id = p_membership;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges: nobody writes tables directly; anonymous (not signed-in) callers get nothing.
-- ---------------------------------------------------------------------------

revoke all on person, groups, memberships, membership_ratings from anon, authenticated;
grant select on person, groups, memberships, membership_ratings to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
