-- Any member can drop their RSVP, and each genuine crossing emails every Admin, so cap it: a Match nudges
-- Admins at most once every ten minutes. A crossing inside the cooldown is swallowed (it still counts as the
-- crossing for that dip, so it does not fire later on the same dip).

alter table matches add column last_at_risk_at timestamptz;

create or replace function private.refresh_at_risk(p_match uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_match matches; v_min int; v_in int; v_cooled boolean;
begin
  select * into v_match from matches where id = p_match for update;
  if not found or v_match.status <> 'rsvps_open' then return; end if;
  select min_players into v_min from groups where id = v_match.group_id;
  select count(*) into v_in from rsvps where match_id = p_match and response = 'in';

  if v_in >= v_min then
    update matches set min_reached = true, at_risk_notified = false, last_in_count = v_in where id = p_match;
  elsif v_match.min_reached and not v_match.at_risk_notified and v_in < v_match.last_in_count then
    v_cooled := v_match.last_at_risk_at is null or v_match.last_at_risk_at < now() - interval '10 minutes';
    update matches set
      at_risk_notified = true,
      last_in_count = v_in,
      last_at_risk_at = case when v_cooled then now() else last_at_risk_at end
    where id = p_match;
    if v_cooled then
      perform private.emit_notification('match_at_risk', v_match.group_id, p_match,
        jsonb_build_object('in', v_in, 'minimum', v_min));
    end if;
  else
    update matches set last_in_count = v_in where id = p_match;
  end if;
end $$;
