-- Fixes from review of the notification layer.

-- The delivery worker's function checks the caller's role itself, so a stray blanket grant (or the default
-- privileges on a re-created function) cannot open it to signed-in users.
create or replace function claim_pending_notifications(p_limit int default 50) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_events jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'only the service role can claim notifications';
  end if;
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
  into v_events
  from marked e join groups g on g.id = e.group_id;
  return v_events;
end $$;

revoke all on sequence notification_events_id_seq from anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- At-risk: only a real drop counts, and the Match row is locked so concurrent changes cannot double-fire.
-- ---------------------------------------------------------------------------------------------------
alter table matches add column last_in_count int not null default 0;

create or replace function private.refresh_at_risk(p_match uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_match matches; v_min int; v_in int;
begin
  select * into v_match from matches where id = p_match for update;
  if not found or v_match.status <> 'rsvps_open' then return; end if;
  select min_players into v_min from groups where id = v_match.group_id;
  select count(*) into v_in from rsvps where match_id = p_match and response = 'in';

  if v_in >= v_min then
    update matches set min_reached = true, at_risk_notified = false, last_in_count = v_in where id = p_match;
  elsif v_match.min_reached and not v_match.at_risk_notified and v_in < v_match.last_in_count then
    update matches set at_risk_notified = true, last_in_count = v_in where id = p_match;
    perform private.emit_notification('match_at_risk', v_match.group_id, p_match,
      jsonb_build_object('in', v_in, 'minimum', v_min));
  else
    update matches set last_in_count = v_in where id = p_match;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- A time zone for the Group, so Matches that did not come from a template show the right local time.
-- Changing the minimum starts the at-risk bookkeeping afresh for Matches that are open.
-- ---------------------------------------------------------------------------------------------------
alter table groups add column timezone text not null default 'UTC';
grant select (timezone) on groups to authenticated;

drop function update_group(uuid, text, int, boolean);
create function update_group(
  p_group uuid, p_name text default null, p_min_players int default null,
  p_show_team_strength boolean default null, p_timezone text default null
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_group_admin(p_group) then raise exception 'only an admin can change group settings'; end if;
  if p_timezone is not null and not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'unknown time zone';
  end if;
  update groups set
    name = coalesce(trim(p_name), name),
    min_players = coalesce(p_min_players, min_players),
    show_team_strength = coalesce(p_show_team_strength, show_team_strength),
    timezone = coalesce(p_timezone, timezone)
  where id = p_group;

  if p_min_players is not null then
    update matches m set
      min_reached = (select count(*) from rsvps r where r.match_id = m.id and r.response = 'in') >= p_min_players,
      at_risk_notified = false,
      last_in_count = (select count(*) from rsvps r where r.match_id = m.id and r.response = 'in')
    where m.group_id = p_group and m.status = 'rsvps_open';
  end if;
end $$;

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function claim_pending_notifications(int) from public, anon, authenticated;
grant execute on function claim_pending_notifications(int) to service_role;
