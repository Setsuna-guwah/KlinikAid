-- KlinikAid Migration 20: stop deriving the signup role from client-controlled metadata
--
-- CONTEXT
-- migration_18 handle_new_user reads the role straight out of raw_user_meta_data:
--
--   default_role := coalesce(new.raw_user_meta_data->>'role', 'patient');
--   if default_role not in ('admin','receptionist','department_staff','medical_specialist','patient') ...
--
-- raw_user_meta_data is the `data` bag a caller supplies at sign-up. It is fully
-- user-writable: the browser holds the anon key, so
--   supabase.auth.signUp({ email, password, options: { data: { role: 'admin' } } })
-- bypasses every server action in this app and lands an admin profile directly.
-- The allow-list on the line above deliberately includes 'admin'.
--
-- FIX
-- Read the privilege-bearing fields from raw_app_meta_data instead. In GoTrue,
-- app_metadata can only be written by the service role; a user can only ever
-- change their own user_metadata. The two legitimate creation paths
-- (src/app/api/admin/staff/route.ts and src/lib/patient/createPatient.ts) both
-- use auth.admin.createUser on a service-role client, so they can set app_metadata
-- and keep provisioning staff with their intended role.
--
-- full_name stays on user_metadata: it is not privilege-bearing.
--
-- A mismatch between a claimed user_metadata role and the role actually granted
-- is logged, so signup probing shows up in system_logs instead of vanishing.

begin;

create or replace function public.handle_new_user()
returns trigger as $$
declare
  default_name text;
  default_role text;
  default_dept text;
  claimed_role text;
  default_role_id uuid;
begin
  default_name := coalesce(new.raw_user_meta_data->>'full_name', 'New User');

  -- A self-service caller can populate this field. Recorded for forensics only;
  -- it is deliberately NOT used to decide the granted role.
  claimed_role := new.raw_user_meta_data->>'role';

  -- PRIVILEGE-SOURCING: app_metadata only. user_metadata is attacker-controlled.
  default_role := coalesce(new.raw_app_meta_data->>'role', 'patient');
  default_dept := new.raw_app_meta_data->>'department';

  if default_role not in ('admin', 'receptionist', 'department_staff', 'medical_specialist', 'patient') then
    default_role := 'patient';
  end if;

  if default_role <> 'department_staff' then
    default_dept := null;
  elsif default_dept not in ('laboratory', 'imaging', 'ultrasound', 'ecg') then
    default_dept := null;
  end if;

  select id
  into default_role_id
  from public.roles
  where name = default_role;

  if default_role_id is null then
    select id
    into default_role_id
    from public.roles
    where name = 'patient';
  end if;

  if default_role_id is null then
    begin
      insert into public.system_logs (user_id, event_type, description, metadata)
      values (
        new.id,
        'PROFILE_PROVISIONING_FAILED',
        'Profile provisioning failed: role_id could not be resolved for ' || default_role,
        jsonb_build_object('role', default_role, 'department', default_dept, 'reason', 'missing_role_id')
      );
    exception
      when others then
        null;
    end;

    raise exception 'Profile provisioning failed: role_id could not be resolved for %', default_role;
  end if;

  insert into public.profiles (id, full_name, role, department, role_id)
  values (
    new.id,
    default_name,
    default_role,
    default_dept,
    default_role_id
  );

  begin
    -- Surfaces a signup that tried to claim a privileged role.
    if claimed_role is not null and claimed_role <> default_role then
      insert into public.system_logs (user_id, event_type, description, metadata)
      values (
        new.id,
        'SIGNUP_ROLE_CLAIM_IGNORED',
        'Signup supplied a role in user_metadata that was not honoured; provisioned as ' || default_role,
        jsonb_build_object('claimed_role', claimed_role, 'granted_role', default_role)
      );
    end if;

    insert into public.system_logs (user_id, event_type, description, metadata)
    values (
      new.id,
      'USER_REGISTERED',
      'User account created automatically: ' || default_name || ' (' || default_role || ')',
      jsonb_build_object('role', default_role, 'department', default_dept, 'role_id', default_role_id)
    );
  exception
    when others then
      null;
  end;

  return new;
exception
  when others then
    begin
      insert into public.system_logs (user_id, event_type, description, metadata)
      values (
        new.id,
        'PROFILE_PROVISIONING_FAILED',
        'Profile provisioning failed during signup trigger',
        jsonb_build_object(
          'role', default_role,
          'department', default_dept,
          'role_id', default_role_id,
          'error', sqlerrm
        )
      );
    exception
      when others then
        null;
    end;

    raise;
end;
$$ language plpgsql security definer set search_path = public;

commit;

-- ---------------------------------------------------------------------------
-- VERIFICATION (run after applying):
--   select pg_get_functiondef('public.handle_new_user()'::regprocedure)
--     like '%raw_app_meta_data->>''role''%'  as reads_app_metadata;
-- expect t
-- ---------------------------------------------------------------------------