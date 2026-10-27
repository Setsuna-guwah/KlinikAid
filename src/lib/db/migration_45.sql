-- KlinikAid Migration 45: the staff registry's rows and emails in one call
-- Why: GET /api/admin/staff read the profiles, then resolved each staff member's
-- email with one auth.admin.getUserById request, in batches of 10: about 21
-- sequential round trips per registry load. Staff Management took 2.9 s against a
-- 800 ms budget and the hard load of /admin/staff 3.8 s against 1.5 s (issue #236).
-- Adds list_staff_registry(): the non-patient profiles the registry renders, with
-- auth.users.email joined in, returned in one query. It is checked the same way
-- as every other staff.manage gate: user_has_permission() applies the is_active
-- and MFA (AAL2) rules, and the function refuses any other caller with 42501.
-- A profile with no Auth user is kept, with a null email, as #229 requires.
-- ORDERING: optional for deploy. The app falls back to the per-profile Auth lookups
-- when this function is missing (PGRST202), so the code may ship before this is
-- applied. Apply before relying on the single call for latency.
-- SNAPSHOT: written but not applied; do not regenerate schema.sql until applied.
-- ROLLBACK: drop function public.list_staff_registry(); the app falls back.

begin;

create or replace function public.list_staff_registry()
returns table (
  id uuid,
  full_name text,
  email text,
  role text,
  role_id uuid,
  department text,
  employee_type text,
  is_active boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.user_has_permission((select auth.uid()), 'staff.manage') then
    raise exception 'FORBIDDEN: Missing permission staff.manage' using errcode = '42501';
  end if;

  return query
    select p.id,
           p.full_name,
           u.email::text,
           p.role,
           p.role_id,
           p.department,
           p.employee_type,
           p.is_active,
           p.created_at
      from public.profiles p
      left join auth.users u on u.id = p.id
     where p.role <> 'patient'
     order by p.created_at desc;
end;
$$;

revoke all on function public.list_staff_registry() from public, anon;
grant execute on function public.list_staff_registry() to authenticated;

commit;
