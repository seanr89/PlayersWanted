-- Notifications. Commands write events to an outbox table in the same transaction as the change, so an
-- event cannot be lost or sent for a change that rolled back. A delivery worker (service role only) claims
-- them and hands them to channels in TypeScript; the channels (web push, email, ...) are pluggable.
--
-- Events: RSVPs opened, Match at risk (Admins only, once per downward crossing of the minimum), Teams
-- published, Teams changed after a confirmed fix, Match cancelled.

create type notification_kind as enum
  ('rsvps_opened', 'match_at_risk', 'teams_published', 'teams_changed', 'match_cancelled');

create table notification_events (
  id bigserial primary key,
  kind notification_kind not null,
  group_id uuid not null references groups (id) on delete cascade,
  match_id uuid references matches (id) on delete cascade,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  dispatched_at timestamptz
);
create index notification_events_pending on notification_events (id) where dispatched_at is null;
alter table notification_events enable row level security; -- no policies: only the service role reads it

-- "At risk" state per Match: the minimum must have been reached before dropping below it counts as a crossing.
alter table matches
  add column min_reached boolean not null default false,
  add column at_risk_notified boolean not null default false;

create function private.emit_notification(p_kind notification_kind, p_group uuid, p_match uuid, p_payload jsonb default '{}')
returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into notification_events (kind, group_id, match_id, payload) values (p_kind, p_group, p_match, p_payload)
$$;

create function private.refresh_at_risk(p_match uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_match matches; v_min int; v_in int;
begin
  select m.* into v_match from matches m where m.id = p_match;
  if not found or v_match.status <> 'rsvps_open' then return; end if;
  select min_players into v_min from groups where id = v_match.group_id;
  select count(*) into v_in from rsvps where match_id = p_match and response = 'in';
  if v_in >= v_min then
    update matches set min_reached = true, at_risk_notified = false
      where id = p_match and (not min_reached or at_risk_notified);
  elsif v_match.min_reached and not v_match.at_risk_notified then
    update matches set at_risk_notified = true where id = p_match;
    perform private.emit_notification('match_at_risk', v_match.group_id, p_match,
      jsonb_build_object('in', v_in, 'minimum', v_min));
  end if;
end $$;

create function private.rsvps_changed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform private.refresh_at_risk(coalesce(new.match_id, old.match_id));
  return null;
end $$;

create trigger rsvps_at_risk after insert or update of response or delete on rsvps
  for each row execute function private.rsvps_changed();

-- The delivery worker claims pending events (at most once each) with who should be told.
create function claim_pending_notifications(p_limit int default 50) returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  with picked as (
    select id from notification_events where dispatched_at is null order by id limit p_limit for update skip locked
  ),
  marked as (
    update notification_events e set dispatched_at = now() from picked where e.id = picked.id returning e.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'kind', e.kind, 'groupId', e.group_id, 'groupName', g.name, 'matchId', e.match_id,
    'payload', e.payload,
    'recipients', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'personId', p.id, 'membershipId', ms.id, 'displayName', ms.display_name,
        'authUserId', p.auth_user_id, 'isAdmin', ms.role in ('owner', 'admin')) order by ms.display_name), '[]'::jsonb)
      from memberships ms join person p on p.id = ms.person_id
      where ms.group_id = e.group_id and ms.guest_match_id is null and not ms.departed
        and (e.kind <> 'match_at_risk' or ms.role in ('owner', 'admin'))
    )) order by e.id), '[]'::jsonb)
  from marked e join groups g on g.id = e.group_id
$$;

revoke all on notification_events from anon, authenticated;

-- Commands that now emit events (their current definitions, plus the emit call).
CREATE OR REPLACE FUNCTION public.open_rsvps(p_match uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_group uuid;
begin
  select group_id into v_group from matches where id = p_match and status = 'scheduled';
  if v_group is null or not is_group_admin(v_group) then
    raise exception 'only an admin can open RSVPs on a scheduled match';
  end if;
  update matches set status = 'rsvps_open' where id = p_match;
  perform private.emit_notification('rsvps_opened', v_group, p_match);
end $function$;

CREATE OR REPLACE FUNCTION public.publish_teams(p_match uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_match matches;
begin
  select * into v_match from matches where id = p_match;
  if not found or not is_group_admin(v_match.group_id) then raise exception 'only an admin can publish teams'; end if;
  if v_match.status <> 'rsvps_open' then raise exception 'teams can only be published while RSVPs are open'; end if;
  if not exists (select 1 from teams where match_id = p_match and state = 'draft') then
    raise exception 'there is no draft to publish';
  end if;
  if not draft_matches_playing(
       p_match,
       (select coalesce(array_agg(membership_id), '{}') from team_players where match_id = p_match and side = 'A'),
       (select coalesce(array_agg(membership_id), '{}') from team_players where match_id = p_match and side = 'B')) then
    raise exception 'the draft is out of date: regenerate it before publishing';
  end if;
  update teams set state = 'published', published_at = now() where match_id = p_match;
  update matches set status = 'teams_published' where id = p_match;
  perform private.emit_notification('teams_published', v_match.group_id, p_match);
end $function$;

CREATE OR REPLACE FUNCTION public.cancel_match(p_match uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_match matches;
begin
  select * into v_match from matches where id = p_match;
  if not found or not is_group_admin(v_match.group_id) then raise exception 'only an admin can cancel a match'; end if;
  if v_match.status = 'cancelled' then raise exception 'this match is already cancelled'; end if;
  if v_match.status = 'played' then raise exception 'a played match cannot be cancelled'; end if;
  update matches set status = 'cancelled' where id = p_match;
  -- Only tell people about a Match they were told about.
  if v_match.status in ('rsvps_open', 'teams_published') then
    perform private.emit_notification('match_cancelled', v_match.group_id, p_match);
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.confirm_fix(p_match uuid, p_team_a uuid[], p_team_b uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_match matches;
  v_new uuid[];
  v_still uuid[];
  v_holders int;
  v_extras uuid[];
  v_queue uuid[];
begin
  select * into v_match from matches where id = p_match;
  if not found or not is_group_admin(v_match.group_id) then raise exception 'only an admin can confirm a fix'; end if;
  if v_match.status <> 'teams_published' then raise exception 'there are no published teams to fix'; end if;
  if p_team_a is null or p_team_b is null then raise exception 'a fix must list both teams'; end if;
  v_new := p_team_a || p_team_b;
  if cardinality(v_new) = 0 or array_position(v_new, null) is not null then
    raise exception 'a fix must list the players on each team';
  end if;
  if cardinality(v_new) <> (select count(distinct x) from unnest(v_new) x) then
    raise exception 'a player appears more than once';
  end if;

  select coalesce(array_agg(tp.membership_id), '{}') into v_still
    from team_players tp join rsvps r
      on r.match_id = tp.match_id and r.membership_id = tp.membership_id and r.response = 'in'
    where tp.match_id = p_match;
  select count(*) into v_holders from team_players where match_id = p_match;
  if cardinality(v_still) = v_holders then raise exception 'nobody has dropped out'; end if;
  if not (v_still <@ v_new) then raise exception 'the fix removes someone who is still in'; end if;

  v_extras := array(select x from unnest(v_new) x where x <> all (v_still));
  select coalesce(array_agg(membership_id order by waitlist_position), '{}') into v_queue
    from match_rsvps(p_match) where status = 'waitlist';
  if cardinality(v_extras) <> least(v_holders - cardinality(v_still), cardinality(v_queue))
     or (select coalesce(array_agg(x order by x), '{}') from unnest(v_extras) x)
        is distinct from (select coalesce(array_agg(x order by x), '{}')
                          from unnest(v_queue[1:cardinality(v_extras)]) x) then
    raise exception 'every vacated slot must be filled from the waitlist, in order';
  end if;
  if cardinality(v_new) > v_match.capacity then raise exception 'the fix exceeds the match capacity'; end if;

  delete from team_players where match_id = p_match;
  insert into team_players (match_id, membership_id, side)
    select p_match, x, 'A'::team_side from unnest(p_team_a) x
    union all select p_match, x, 'B'::team_side from unnest(p_team_b) x;
  update teams set revision = revision + 1, dismissed_fix_key = null where match_id = p_match;
  perform private.emit_notification('teams_changed', v_match.group_id, p_match,
    jsonb_build_object('revision', (select revision from teams where match_id = p_match)));

  delete from memberships m using rsvps r
    where m.guest_match_id = p_match and r.membership_id = m.id and r.response = 'out'
      and not exists (select 1 from team_players tp where tp.membership_id = m.id);
  delete from memberships m
    where m.group_id = v_match.group_id and m.departed
      and not exists (select 1 from rsvps r where r.membership_id = m.id)
      and not exists (select 1 from team_players tp where tp.membership_id = m.id);
end $function$;

CREATE OR REPLACE FUNCTION private.run_recurring_templates(p_now timestamp with time zone DEFAULT now(), p_group uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      with opened as (
        update matches set status = 'rsvps_open'
          where template_id = tpl.id and status = 'scheduled' and starts_at > p_now
            and p_now >= starts_at - make_interval(days => tpl.rsvp_lead_days)
          returning id, group_id)
      insert into notification_events (kind, group_id, match_id)
        select 'rsvps_opened', group_id, id from opened;
    exception when others then
      raise warning 'recurring template % could not be processed: %', tpl.id, sqlerrm;
    end;
  end loop;
  return v_created;
end $function$;

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
-- The delivery worker's function is for the service role only: undo the blanket grant above for it.
-- (Later migrations that re-run the blanket grant must repeat this; a test guards it.)
revoke execute on function claim_pending_notifications(int) from public, anon, authenticated;
grant execute on function claim_pending_notifications(int) to service_role;
