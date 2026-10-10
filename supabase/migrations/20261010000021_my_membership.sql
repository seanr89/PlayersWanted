-- Who am I in this Group? The UI needs the caller's own Membership id (to find their RSVP and Team).

create function my_membership(p_group uuid) returns table (id uuid, display_name text, role member_role, claim claim_state)
language sql stable security definer set search_path = public, pg_temp as $$
  select m.id, m.display_name, m.role, m.claim from memberships m
  where m.group_id = p_group and m.person_id = current_person_id() and m.guest_match_id is null and not m.departed
$$;

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
-- Service-role-only function: undo the blanket grant (it also checks the role itself).
revoke execute on function claim_pending_notifications(int) from public, anon, authenticated;
grant execute on function claim_pending_notifications(int) to service_role;
