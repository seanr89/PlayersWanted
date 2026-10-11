-- The weekly Recurring template: at most one per Group. A scheduled job creates the next Match from it and
-- opens RSVPs at the lead time. Single Matches can be edited or cancelled without touching the template,
-- because each generated Match remembers which occurrence it was made for.

create table recurring_templates (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null unique references groups (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6), -- 0 = Sunday
  start_time time not null,
  timezone text not null,                                    -- the Group's local time, so 7pm stays 7pm across DST
  venue_id uuid references venues (id) on delete set null,
  capacity int not null default 10 check (capacity > 0),
  cost_per_player numeric(6, 2) check (cost_per_player >= 0), -- null: use the Venue's default cost
  rsvp_lead_days int not null default 3 check (rsvp_lead_days >= 0),
  rsvp_deadline_hours_before int check (rsvp_deadline_hours_before >= 0), -- null: no deadline
  paused boolean not null default false,
  created_at timestamptz not null default now()
);

alter table matches
  add column template_id uuid references recurring_templates (id) on delete set null,
  add column template_occurrence timestamptz;
create unique index matches_one_per_occurrence on matches (template_id, template_occurrence)
  where template_id is not null;

alter table recurring_templates enable row level security;
create policy templates_members on recurring_templates for select using (is_group_member(group_id));

-- The first start strictly after p_now on the given weekday and local time. Computed on local clock time so
-- the hour is right on both sides of a daylight-saving change.
create function private.next_occurrence(p_weekday int, p_start time, p_tz text, p_now timestamptz) returns timestamptz
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v_local timestamp := p_now at time zone p_tz;
  v_date date := v_local::date;
  v_candidate timestamp;
begin
  v_candidate := (v_date + (((p_weekday - extract(dow from v_date)::int) + 7) % 7)) + p_start;
  if v_candidate <= v_local then v_candidate := v_candidate + interval '7 days'; end if;
  return v_candidate at time zone p_tz;
end $$;

-- Idempotent: safe to run as often as you like. Returns how many Matches it created.
create function private.run_recurring_templates(p_now timestamptz default now(), p_group uuid default null)
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  tpl recurring_templates;
  v_next timestamptz;
  v_id uuid;
  v_created int := 0;
begin
  for tpl in select * from recurring_templates where not paused and (p_group is null or group_id = p_group) loop
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
  end loop;

  -- Open RSVPs once a generated Match is within the lead time. Manually created Matches are opened by hand.
  update matches m set status = 'rsvps_open'
    from recurring_templates t
    where m.template_id = t.id and not t.paused and m.status = 'scheduled'
      and (p_group is null or m.group_id = p_group)
      and m.starts_at > p_now
      and p_now >= m.starts_at - make_interval(days => t.rsvp_lead_days);
  return v_created;
end $$;

create function save_recurring_template(
  p_group uuid, p_weekday int, p_start_time text, p_timezone text, p_venue uuid default null,
  p_capacity int default 10, p_cost numeric default null, p_lead_days int default 3,
  p_deadline_hours int default null
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_time time;
begin
  if not is_group_admin(p_group) then raise exception 'only an admin can change the recurring template'; end if;
  if p_weekday is null or p_weekday not between 0 and 6 then
    raise exception 'weekday must be 0 (Sunday) to 6 (Saturday)';
  end if;
  begin
    v_time := p_start_time::time;
  exception when others then
    raise exception 'the start time must be a time of day like 19:00';
  end;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'unknown time zone';
  end if;
  if p_capacity is null or p_capacity < 1 then raise exception 'capacity must be at least 1'; end if;
  if p_lead_days is null or p_lead_days < 0 then raise exception 'RSVP lead time cannot be negative'; end if;
  if p_deadline_hours < 0 then raise exception 'RSVP deadline cannot be negative'; end if;
  if p_venue is not null and not exists (select 1 from venues where id = p_venue and group_id = p_group) then
    raise exception 'that venue does not belong to this group';
  end if;

  insert into recurring_templates (group_id, weekday, start_time, timezone, venue_id, capacity,
                                   cost_per_player, rsvp_lead_days, rsvp_deadline_hours_before)
    values (p_group, p_weekday, v_time, p_timezone, p_venue, p_capacity, p_cost, p_lead_days, p_deadline_hours)
    on conflict (group_id) do update set
      weekday = excluded.weekday, start_time = excluded.start_time, timezone = excluded.timezone,
      venue_id = excluded.venue_id, capacity = excluded.capacity, cost_per_player = excluded.cost_per_player,
      rsvp_lead_days = excluded.rsvp_lead_days, rsvp_deadline_hours_before = excluded.rsvp_deadline_hours_before;
  -- Saving creates next week's Match straight away rather than waiting for the scheduler.
  perform private.run_recurring_templates(now(), p_group);
end $$;

create function set_recurring_paused(p_group uuid, p_paused boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_group_admin(p_group) then raise exception 'only an admin can change the recurring template'; end if;
  update recurring_templates set paused = p_paused where group_id = p_group;
  if not found then raise exception 'this group has no recurring template'; end if;
  if not p_paused then perform private.run_recurring_templates(now(), p_group); end if;
end $$;

-- Run the job every 15 minutes inside the database.
create extension if not exists pg_cron;
select cron.schedule('recurring-matches', '*/15 * * * *', 'select private.run_recurring_templates()');

revoke all on recurring_templates from anon, authenticated;
grant select on recurring_templates to authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
