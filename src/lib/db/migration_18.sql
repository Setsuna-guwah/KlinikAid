-- KlinikAid Migration 18: Harden signup profile role_id provisioning (STAGING FIRST)
-- A3 result: public.roles contains exactly one row where name = 'patient'.
-- No seed step is included. Apply to staging-copy first and run the rollback proof
-- before considering production.

begin;

-- 1. Replace signup trigger so role_id provisioning cannot silently fail.
create or replace function public.handle_new_user()
returns trigger as $$
declare
  default_name text;
  default_role text;
  default_dept text;
  default_role_id uuid;
begin
  default_name := coalesce(new.raw_user_meta_data->>'full_name', 'New User');
  default_role := coalesce(new.raw_user_meta_data->>'role', 'patient');
  default_dept := new.raw_user_meta_data->>'department';

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

-- 2. Backfill profiles that can resolve role_id from the existing role text.
update public.profiles p
set role_id = r.id
from public.roles r
where p.role = r.name
  and p.role_id is null;

-- 3. Validation output for the SQL editor.
select id, name
from public.roles
where name = 'patient';

select p.id, p.role, p.role_id
from public.profiles p
where p.role_id is null
order by p.created_at desc;

commit;
