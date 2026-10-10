-- Edit and cancel a single Match. Any argument left null keeps its current value.

create function update_match(
  p_match uuid, p_starts_at timestamptz default null, p_capacity int default null,
  p_cost numeric default null, p_rsvp_deadline timestamptz default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_match matches;
begin
  select * into v_match from matches where id = p_match;
  if not found or not is_group_admin(v_match.group_id) then raise exception 'only an admin can edit a match'; end if;
  if v_match.status in ('played', 'cancelled') then
    raise exception 'a % match cannot be edited', v_match.status;
  end if;
  -- Changing Capacity after publishing would silently reshuffle who is playing.
  if p_capacity is not null and p_capacity <> v_match.capacity and v_match.status = 'teams_published' then
    raise exception 'capacity cannot change after teams are published';
  end if;
  update matches set
    starts_at = coalesce(p_starts_at, starts_at),
    capacity = coalesce(p_capacity, capacity),
    cost_per_player = coalesce(p_cost, cost_per_player),
    rsvp_deadline = coalesce(p_rsvp_deadline, rsvp_deadline)
  where id = p_match;
end $$;

create function cancel_match(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_match matches;
begin
  select * into v_match from matches where id = p_match;
  if not found or not is_group_admin(v_match.group_id) then raise exception 'only an admin can cancel a match'; end if;
  if v_match.status = 'cancelled' then raise exception 'this match is already cancelled'; end if;
  if v_match.status = 'played' then raise exception 'a played match cannot be cancelled'; end if;
  update matches set status = 'cancelled' where id = p_match;
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
