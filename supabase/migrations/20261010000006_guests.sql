-- Guests: a Membership scoped to one Match, sponsored by the member who added it.
-- A Guest has no Rating row until an Admin sets one; until then team generation uses the Group average.

alter table memberships
  add column guest_match_id uuid references matches (id) on delete cascade,
  add column sponsor_membership_id uuid references memberships (id) on delete cascade,
  add constraint guest_has_sponsor check ((guest_match_id is null) = (sponsor_membership_id is null));

-- Guests have no Rating row yet, so setting one must be able to create it.
create or replace function set_rating(p_membership uuid, p_rating int) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid;
begin
  select group_id into v_group from memberships where id = p_membership;
  if v_group is null or not is_group_admin(v_group) then
    raise exception 'only an admin can set a rating';
  end if;
  insert into membership_ratings (membership_id, rating) values (p_membership, p_rating)
    on conflict (membership_id) do update set rating = excluded.rating;
end $$;

create function add_guest(p_match uuid, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_match matches; v_sponsor uuid; v_guest uuid;
begin
  select * into v_match from matches where id = p_match;
  if not found or not is_group_member(v_match.group_id) then raise exception 'match not found'; end if;
  if v_match.status not in ('rsvps_open', 'teams_published') then
    raise exception 'RSVPs are not open for this match';
  end if;
  select id into v_sponsor from memberships
    where group_id = v_match.group_id and person_id = current_person_id() and guest_match_id is null;
  insert into memberships (group_id, display_name, claim, guest_match_id, sponsor_membership_id)
    values (v_match.group_id, trim(p_name), 'confirmed', p_match, v_sponsor)
    returning id into v_guest;
  insert into rsvps (match_id, membership_id, response) values (p_match, v_guest, 'in');
  return v_guest;
end $$;

-- Before Teams are published a removed Guest simply disappears. After publishing, their place on the
-- Teams must survive until an admin confirms a fix, so the Guest is marked 'out' instead.
create function remove_guest(p_guest uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_guest memberships; v_status match_status;
begin
  select * into v_guest from memberships where id = p_guest;
  if not found or v_guest.guest_match_id is null then raise exception 'that is not a guest'; end if;
  if not (is_group_admin(v_guest.group_id) or exists (
        select 1 from memberships s
        where s.id = v_guest.sponsor_membership_id and s.person_id = current_person_id())) then
    raise exception 'not allowed to remove this guest';
  end if;
  select status into v_status from matches where id = v_guest.guest_match_id;
  if v_status = 'teams_published' then
    update rsvps set response = 'out', responded_at = clock_timestamp()
      where membership_id = p_guest and match_id = v_guest.guest_match_id;
  else
    delete from memberships where id = p_guest;
  end if;
end $$;

create function promote_guest(p_guest uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_guest memberships;
begin
  select * into v_guest from memberships where id = p_guest;
  if not found or v_guest.guest_match_id is null then raise exception 'that is not a guest'; end if;
  if not is_group_admin(v_guest.group_id) then raise exception 'only an admin can promote a guest'; end if;
  insert into membership_ratings (membership_id, rating)
    select p_guest, coalesce(round(avg(r.rating))::int, 50)
    from membership_ratings r join memberships m on m.id = r.membership_id
    where m.group_id = v_guest.group_id and m.guest_match_id is null
    on conflict (membership_id) do nothing;
  update memberships set guest_match_id = null, sponsor_membership_id = null, claim = 'ghost'
    where id = p_guest;
end $$;

drop function match_rsvps(uuid);
create function match_rsvps(p_match uuid) returns table (
  membership_id uuid, display_name text, response text, status text,
  waitlist_position int, late_dropout boolean, is_guest boolean
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
    case when is_group_admin(f.group_id) then f.late_dropout end,
    ms.guest_match_id is not null
  from flagged f join memberships ms on ms.id = f.membership_id
  order by (f.response = 'out'), (not f.is_playing), f.responded_at, f.id
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
