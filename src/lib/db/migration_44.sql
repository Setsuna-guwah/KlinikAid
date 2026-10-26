-- KlinikAid Migration 44: the dashboard's role name and permissions in one call
-- Why: the dashboard layout asked user_has_permission once per permission name
-- (17 separate PostgREST requests on every navigation) and read the role name in
-- a separate query after the profile. The slowest of those requests queued behind
-- the others, and the navigation waited for all of them (issue #238).
-- Adds dashboard_access_context(): the caller's role name and the permission names
-- they hold, computed with the same join, the same is_active check and the same
-- auth_session_satisfies_mfa() gate that user_has_permission uses. user_has_permission
-- is unchanged and still answers every other caller.
-- ORDERING: optional for deploy. The app falls back to per-permission checks when
-- this function is missing or fails, so the code may ship before this is applied.
-- Apply before relying on the single call for latency; the fallback is correct but slower.
-- SNAPSHOT: written but not applied; do not regenerate schema.sql until applied.
-- ROLLBACK: drop function public.dashboard_access_context(); the app falls back.

begin;

create or replace function public.dashboard_access_context()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'role_name', (
      select r.name
        from public.profiles p
        join public.roles r on r.id = p.role_id
       where p.id = auth.uid()
    ),
    'permissions', coalesce((
      select jsonb_agg(pe.name order by pe.name)
        from public.profiles pr
        join public.role_permissions rp on pr.role_id = rp.role_id
        join public.permissions pe on rp.permission_id = pe.id
       where pr.id = auth.uid()
         and pr.is_active
         and public.auth_session_satisfies_mfa()
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.dashboard_access_context() from public, anon;
grant execute on function public.dashboard_access_context() to authenticated, service_role;

commit;
