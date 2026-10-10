-- Fixes from review of venues and the recurring template.

-- ---------------------------------------------------------------------------------------------------
-- Bounds, so one Group's template can never make the scheduler fail for everyone.
-- ---------------------------------------------------------------------------------------------------
-- Bring any existing out-of-range values inside the new bounds first.
update recurring_templates set
  rsvp_lead_days = least(rsvp_lead_days, 60),
  rsvp_deadline_hours_before = least(rsvp_deadline_hours_before, 720);

alter table recurring_templates
  add constraint recurring_lead_days_bounds check (rsvp_lead_days <= 60),
  add constraint recurring_deadline_bounds check (rsvp_deadline_hours_before <= 720);

-- ---------------------------------------------------------------------------------------------------
-- Maps links: one clean web address. No whitespace, control characters, quotes or angle brackets.
-- ---------------------------------------------------------------------------------------------------
-- Links saved under the old, looser rule that do not meet the new one are cleared rather than kept.
update venues set maps_url = null
  where maps_url is not null and maps_url !~* '^https?://[^[:space:][:cntrl:]<>"'']+$';
alter table venues drop constraint venues_maps_url_check;
alter table venues add constraint venues_maps_url_check
  check (char_length(maps_url) <= 500 and maps_url ~* '^https?://[^[:space:][:cntrl:]<>"'']+$');

create or replace function check_maps_url(p_url text) returns void
language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if p_url is not null and (char_length(p_url) > 500 or p_url !~* '^https?://[^[:space:][:cntrl:]<>"'']+$') then
    raise exception 'the maps link must be a single web address starting with http:// or https://';
  end if;
end $$;

-- Venue names: trimmed, not blank, no control characters.
create function private.clean_venue_name(p_name text) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare v_name text := trim(p_name);
begin
  if v_name is null or v_name = '' then raise exception 'a venue name cannot be blank'; end if;
  if v_name ~ '[[:cntrl:]]' then raise exception 'a venue name cannot contain control characters'; end if;
  if char_length(v_name) > 80 then raise exception 'a venue name can be at most 80 characters'; end if;
  return v_name;
end $$;

create or replace function create_venue(
  p_group uuid, p_name text, p_address text default null, p_maps_url text default null, p_default_cost numeric default 0
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_constraint text;
begin
  if not is_group_admin(p_group) then raise exception 'only an admin can add a venue'; end if;
  perform check_maps_url(p_maps_url);
  insert into venues (group_id, name, address, maps_url, default_cost)
    values (p_group, private.clean_venue_name(p_name), p_address, p_maps_url, coalesce(p_default_cost, 0))
    returning id into v_id;
  return v_id;
exception when unique_violation then
  get stacked diagnostics v_constraint = constraint_name;
  if v_constraint = 'venues_one_name_per_group' then
    raise exception 'a venue with that name already exists in this group';
  end if;
  raise;
end $$;

-- Two admins typing the same new venue at once both get the one that was saved first.
create or replace function find_or_create_venue(p_group uuid, p_name text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_name text;
begin
  if not is_group_admin(p_group) then raise exception 'only an admin can add a venue'; end if;
  v_name := private.clean_venue_name(p_name);
  select id into v_id from venues where group_id = p_group and lower(trim(name)) = lower(v_name);
  if v_id is null then
    begin
      insert into venues (group_id, name) values (p_group, v_name) returning id into v_id;
    exception when unique_violation then
      select id into v_id from venues where group_id = p_group and lower(trim(name)) = lower(v_name);
    end;
  end if;
  return v_id;
end $$;

-- Arguments left null keep the current value; the clear flags remove an address or maps link.
drop function update_venue(uuid, text, text, text, numeric);
create function update_venue(
  p_venue uuid, p_name text default null, p_address text default null, p_maps_url text default null,
  p_default_cost numeric default null, p_clear_address boolean default false, p_clear_maps_url boolean default false
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_group uuid; v_constraint text;
begin
  select group_id into v_group from venues where id = p_venue;
  if v_group is null or not is_group_admin(v_group) then raise exception 'only an admin can edit a venue'; end if;
  perform check_maps_url(p_maps_url);
  update venues set
    name = case when p_name is null then name else private.clean_venue_name(p_name) end,
    address = case when p_clear_address then null else coalesce(p_address, address) end,
    maps_url = case when p_clear_maps_url then null else coalesce(p_maps_url, maps_url) end,
    default_cost = coalesce(p_default_cost, default_cost)
  where id = p_venue;
exception when unique_violation then
  get stacked diagnostics v_constraint = constraint_name;
  if v_constraint = 'venues_one_name_per_group' then
    raise exception 'a venue with that name already exists in this group';
  end if;
  raise;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- The scheduler job: each template is handled on its own, so one failing template is logged and skipped
-- rather than stopping every Group's Matches from being made.
-- ---------------------------------------------------------------------------------------------------
create or replace function private.run_recurring_templates(p_now timestamptz default now(), p_group uuid default null)
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  tpl recurring_templates;
  v_next timestamptz;
  v_id uuid;
  v_created int := 0;
begin
  for tpl in select * from recurring_templates where not paused and (p_group is null or group_id = p_group) loop
    begin
      v_next := private.next_occurrence(tpl.weekday, tpl.start_time, tpl.timezone, p_now);
      v_id := null;
      insert into matches (group_id, starts_at, capacity, cost_per_player, rsvp_deadline, venue_id,
                           template_id, template_occurrence)
        values (
          tpl.group_id, v_next, tpl.capacity,
          coalesce(tpl.cost_per_player, (select default_cost from venues where id = tpl.venue_id), 0),
          case when tpl.rsvp_deadline_hours_before is null then null
               else v_next - make_interval(hours => tpl.rsvp_deadline_hours_before) end,
          tpl.venue_id, tpl.id, v_next)
        on conflict (template_id, template_occurrence) where template_id is not null do nothing
        returning id into v_id;
      if v_id is not null then v_created := v_created + 1; end if;

      -- Open RSVPs once a generated Match is within the lead time. Manual Matches are opened by hand.
      update matches set status = 'rsvps_open'
        where template_id = tpl.id and status = 'scheduled' and starts_at > p_now
          and p_now >= starts_at - make_interval(days => tpl.rsvp_lead_days);
    exception when others then
      raise warning 'recurring template % could not be processed: %', tpl.id, sqlerrm;
    end;
  end loop;
  return v_created;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- Saving the template: stricter validation, and a change of night replaces a Match nobody has seen yet.
-- ---------------------------------------------------------------------------------------------------
create or replace function save_recurring_template(
  p_group uuid, p_weekday int, p_start_time text, p_timezone text, p_venue uuid default null,
  p_capacity int default 10, p_cost numeric default null, p_lead_days int default 3,
  p_deadline_hours int default null
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_time time; v_old recurring_templates;
begin
  if not is_group_admin(p_group) then raise exception 'only an admin can change the recurring template'; end if;
  if p_weekday is null or p_weekday not between 0 and 6 then
    raise exception 'weekday must be 0 (Sunday) to 6 (Saturday)';
  end if;
  if p_start_time is null or p_start_time !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then
    raise exception 'the start time must be a time of day like 19:00';
  end if;
  v_time := p_start_time::time;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'unknown time zone';
  end if;
  if p_capacity is null or p_capacity < 1 then raise exception 'capacity must be at least 1'; end if;
  if p_lead_days is null or p_lead_days not between 0 and 60 then
    raise exception 'RSVP lead time must be between 0 and 60 days';
  end if;
  if p_deadline_hours is not null and p_deadline_hours not between 0 and 720 then
    raise exception 'RSVP deadline must be between 0 and 720 hours before kick-off';
  end if;
  if p_venue is not null and not exists (select 1 from venues where id = p_venue and group_id = p_group) then
    raise exception 'that venue does not belong to this group';
  end if;

  select * into v_old from recurring_templates where group_id = p_group;
  insert into recurring_templates (group_id, weekday, start_time, timezone, venue_id, capacity,
                                   cost_per_player, rsvp_lead_days, rsvp_deadline_hours_before)
    values (p_group, p_weekday, v_time, p_timezone, p_venue, p_capacity, p_cost, p_lead_days, p_deadline_hours)
    on conflict (group_id) do update set
      weekday = excluded.weekday, start_time = excluded.start_time, timezone = excluded.timezone,
      venue_id = excluded.venue_id, capacity = excluded.capacity, cost_per_player = excluded.cost_per_player,
      rsvp_lead_days = excluded.rsvp_lead_days, rsvp_deadline_hours_before = excluded.rsvp_deadline_hours_before;

  -- A new night or time means the Match made for the old one is wrong. Replace it, but only if nobody has
  -- seen it (still 'scheduled'), it is still on its original slot, and it has not started.
  if v_old.id is not null and (v_old.weekday, v_old.start_time, v_old.timezone)
       is distinct from (p_weekday::smallint, v_time, p_timezone) then
    delete from matches
      where template_id = v_old.id and status = 'scheduled' and starts_at = template_occurrence and starts_at > now();
  end if;
  perform private.run_recurring_templates(now(), p_group);
end $$;

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
