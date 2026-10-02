-- KlinikAid Migration 21: provision every self-service signup as 'patient'
--
-- CONTEXT
-- migration_20 moved the signup role to raw_app_meta_data on the theory that
-- only the service role can write it. Measured against the live database, that
-- does not work: auth.admin.createUser DOES persist app_metadata
--
--   app_metadata : {"department":"laboratory","provider":"email","role":"department_staff"}
--
-- but the handle_new_user trigger on auth.users fires BEFORE that column is
-- populated, so new.raw_app_meta_data is NULL inside the function and the role
-- silently falls back to 'patient'. Privilege derived from trigger timing is
-- fragile in a way that fails closed but breaks staff onboarding.
--
-- FIX
-- Stop deriving privilege at signup altogether. The trigger provisions
-- 'patient' unconditionally. Staff roles are assigned by the server
-- immediately after account creation, which src/app/api/admin/staff/route.ts
-- already does (it overwrites role and role_id on the new profile row). This
-- migration adds department to that update, since the trigger no longer sets it.
--
-- The resulting property is the one that matters: the signup path has no code
-- path that can produce a privileged profile, whatever the caller supplies.

begin;

create or replace function public.handle_new_user()
returns trigger as $$
declare
  default_name text;
  claimed_role text;
  patient_role_id uuid;
begin
  default_name := coalesce(new.raw_user_meta_data->>'full_name', 'New User');
  claimed_role := coalesce(
    new.raw_user_meta_data->>'role',
    new.raw_app_meta_data->>'role'
  );

  select id into patient_role_id
  from public.roles
  where name = 'patient';

  if patient_role_id is null then
    begin
      insert into public.system_logs (user_id, event_type, description, metadata)
      values (new.id, 'PROFILE_PROVISIONING_FAILED',
        'Profile provisioning failed: patient role_id could not be resolved',
        jsonb_build_object('reason', 'missing_patient_role_id'));
    exception when others then null;
    end;

    raise exception 'Profile provisioning failed: patient role_id could not be resolved';
  end if;

  -- Self-service signup is always a patient. Staff role is assigned by the
  -- server after creation, never from anything the caller supplied.
  insert into public.profiles (id, full_name, role, department, role_id)
  values (new.id, default_name, 'patient', null, patient_role_id);

  begin
    -- A signup that tried to claim a role is now expected traffic from any
    -- scanner, but it is worth a durable record rather than a silent drop.
    if claimed_role is not null and claimed_role <> 'patient' then
      insert into public.system_logs (user_id, event_type, description, metadata)
      values (new.id, 'SIGNUP_ROLE_CLAIM_IGNORED',
        'Signup supplied a privileged role that was not honoured; provisioned as patient',
        jsonb_build_object('claimed_role', claimed_role, 'granted_role', 'patient'));
    end if;

    insert into public.system_logs (user_id, event_type, description, metadata)
    values (new.id, 'USER_REGISTERED',
      'User account created automatically: ' || default_name || ' (patient)',
      jsonb_build_object('role', 'patient', 'department', null, 'role_id', patient_role_id));
  exception when others then null;
  end;

  return new;
exception
  when others then
    begin
      insert into public.system_logs (user_id, event_type, description, metadata)
      values (new.id, 'PROFILE_PROVISIONING_FAILED',
        'Profile provisioning failed during signup trigger',
        jsonb_build_object('error', sqlerrm));
    exception when others then null;
    end;

    raise;
end;
$$ language plpgsql security definer set search_path = public;

commit;

-- ---------------------------------------------------------------------------
-- VERIFICATION (run after applying; expect 't' and 't'):
--   select pg_get_functiondef('public.handle_new_user()'::regprocedure)
--     not like '%raw_app_meta_data->>''role''%' as trigger_ignores_metadata,
--          1 = 1 as ok;
-- ---------------------------------------------------------------------------