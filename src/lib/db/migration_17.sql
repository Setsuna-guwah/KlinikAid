-- KlinikAid Migration 17: RBAC/RLS Enforcement Flip (STAGING FIRST)
-- Staging artifact only until Operator approves production rollout.
-- Flips staff clinical/admin enforcement from profiles.role text to user_has_permission().
-- Patient own-data policies remain uid-scoped and unchanged.

begin;

-- 1. Bootstrap role-management permissions.
insert into public.permissions (name, description, module) values
  ('roles.manage', 'Create, update, and manage role permission mappings', 'roles'),
  ('roles.read', 'View roles and permission catalog', 'roles')
on conflict (name) do update set
  description = excluded.description,
  module = excluded.module,
  updated_at = timezone('utc', now());

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.name in ('roles.manage', 'roles.read')
where r.name = 'admin'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.name = 'roles.read'
where r.name in ('receptionist', 'department_staff', 'medical_specialist')
on conflict do nothing;

-- 2. Patch signup trigger so new profiles get role_id as well as role text.
create or replace function public.handle_new_user()
returns trigger as $$
declare
  default_name text;
  default_role text;
  default_dept text;
  default_role_id uuid;
begin
  -- Extract metadata safely
  default_name := coalesce(new.raw_user_meta_data->>'full_name', 'New User');
  default_role := coalesce(new.raw_user_meta_data->>'role', 'patient');
  default_dept := new.raw_user_meta_data->>'department';

  -- Enforce valid roles
  if default_role not in ('admin', 'receptionist', 'department_staff', 'medical_specialist', 'patient') then
    default_role := 'patient';
  end if;

  -- Enforce valid department constraints
  if default_role <> 'department_staff' then
    default_dept := null;
  elsif default_dept not in ('laboratory', 'imaging', 'ultrasound', 'ecg') then
    default_dept := null;
  end if;

  select id
  into default_role_id
  from public.roles
  where name = default_role;

  insert into public.profiles (id, full_name, role, department, role_id)
  values (
    new.id,
    default_name,
    default_role,
    default_dept,
    default_role_id
  );
  
  -- Insert default log event
  insert into public.system_logs (user_id, event_type, description, metadata)
  values (
    new.id,
    'USER_REGISTERED',
    'User account created automatically: ' || default_name || ' (' || default_role || ')',
    jsonb_build_object('role', default_role, 'department', default_dept)
  );

  return new;
exception
  when others then
    -- Prevent trigger failure from completely blocking authentication
    return new;
end;
$$ language plpgsql security definer set search_path = public;

-- 3. Backfill profiles created after migration_15 that missed role_id.
update public.profiles p
set role_id = r.id
from public.roles r
where p.role = r.name
  and p.role_id is null;

-- 4. Flip staff/admin RLS policies to permission checks.
drop policy if exists "Admins have full access to profiles" on public.profiles;
drop policy if exists "Clinic staff can view all profiles" on public.profiles;
drop policy if exists "Admins have full access to patients" on public.patients;
drop policy if exists "Receptionists can manage patients" on public.patients;
drop policy if exists "Staff can view all patients" on public.patients;
drop policy if exists "Admins have full access to queue" on public.patient_queue;
drop policy if exists "Receptionists can manage queue" on public.patient_queue;
drop policy if exists "Department staff can view and update queue for their department" on public.patient_queue;
drop policy if exists "Medical specialists can view queue" on public.patient_queue;
drop policy if exists "Admins have full access to documents" on public.documents;
drop policy if exists "Receptionists can view and update documents" on public.documents;
drop policy if exists "Admins have full access to department records" on public.department_records;
drop policy if exists "Department staff can only view/insert/update within their own department" on public.department_records;
drop policy if exists "Admins can view system logs" on public.system_logs;
drop policy if exists "Admins can view chatbot logs" on public.chatbot_logs;
drop policy if exists "Admins can manage RAG documents" on public.rag_documents;

create policy "Admins have full access to profiles"
  on public.profiles for all
  using (public.user_has_permission(auth.uid(), 'profiles.manage'))
  with check (public.user_has_permission(auth.uid(), 'profiles.manage'));

create policy "Clinic staff can view all profiles"
  on public.profiles for select
  using (public.user_has_permission(auth.uid(), 'profiles.read_staff'));

create policy "Admins have full access to patients"
  on public.patients for all
  using (public.user_has_permission(auth.uid(), 'patients.manage'))
  with check (public.user_has_permission(auth.uid(), 'patients.manage'));

create policy "Receptionists can manage patients"
  on public.patients for all
  using (public.user_has_permission(auth.uid(), 'patients.manage'))
  with check (public.user_has_permission(auth.uid(), 'patients.manage'));

create policy "Staff can view all patients"
  on public.patients for select
  using (public.user_has_permission(auth.uid(), 'patients.read'));

create policy "Admins have full access to queue"
  on public.patient_queue for all
  using (public.user_has_permission(auth.uid(), 'queue.manage'))
  with check (public.user_has_permission(auth.uid(), 'queue.manage'));

create policy "Receptionists can manage queue"
  on public.patient_queue for all
  using (public.user_has_permission(auth.uid(), 'queue.manage'))
  with check (public.user_has_permission(auth.uid(), 'queue.manage'));

create policy "Department staff can view and update queue for their department"
  on public.patient_queue for all
  using (
    public.user_has_permission(auth.uid(), 'queue.manage.own_dept')
    and department = public.get_auth_user_dept()
  )
  with check (
    public.user_has_permission(auth.uid(), 'queue.manage.own_dept')
    and department = public.get_auth_user_dept()
  );

create policy "Medical specialists can view queue"
  on public.patient_queue for select
  using (public.user_has_permission(auth.uid(), 'queue.read'));

create policy "Admins have full access to documents"
  on public.documents for all
  using (public.user_has_permission(auth.uid(), 'documents.manage'))
  with check (public.user_has_permission(auth.uid(), 'documents.manage'));

create policy "Receptionists can view and update documents"
  on public.documents for all
  using (public.user_has_permission(auth.uid(), 'documents.manage'))
  with check (public.user_has_permission(auth.uid(), 'documents.manage'));

create policy "Admins have full access to department records"
  on public.department_records for all
  using (public.user_has_permission(auth.uid(), 'records.manage'))
  with check (public.user_has_permission(auth.uid(), 'records.manage'));

create policy "Department staff can only view/insert/update within their own department"
  on public.department_records for all
  using (
    public.user_has_permission(auth.uid(), 'records.manage.own_dept')
    and department = public.get_auth_user_dept()
  )
  with check (
    public.user_has_permission(auth.uid(), 'records.manage.own_dept')
    and department = public.get_auth_user_dept()
  );

create policy "Admins can view system logs"
  on public.system_logs for select
  using (public.user_has_permission(auth.uid(), 'system_logs.read'));

create policy "Admins can view chatbot logs"
  on public.chatbot_logs for select
  using (public.user_has_permission(auth.uid(), 'chatbot_logs.read'));

create policy "Admins can manage RAG documents"
  on public.rag_documents for all
  using (public.user_has_permission(auth.uid(), 'rag_documents.manage'))
  with check (public.user_has_permission(auth.uid(), 'rag_documents.manage'));

-- 5. Flip RBAC catalog policies to role-management permissions.
drop policy if exists "Admins have full access to permissions" on public.permissions;
drop policy if exists "Staff can view permissions" on public.permissions;
drop policy if exists "Admins have full access to roles" on public.roles;
drop policy if exists "Staff can view roles" on public.roles;
drop policy if exists "Admins have full access to role_permissions" on public.role_permissions;
drop policy if exists "Staff can view role_permissions" on public.role_permissions;

create policy "Role managers have full access to permissions"
  on public.permissions for all
  using (public.user_has_permission(auth.uid(), 'roles.manage'))
  with check (public.user_has_permission(auth.uid(), 'roles.manage'));

create policy "Permitted staff can view permissions"
  on public.permissions for select
  using (public.user_has_permission(auth.uid(), 'roles.read'));

create policy "Role managers have full access to roles"
  on public.roles for all
  using (public.user_has_permission(auth.uid(), 'roles.manage'))
  with check (public.user_has_permission(auth.uid(), 'roles.manage'));

create policy "Permitted staff can view roles"
  on public.roles for select
  using (public.user_has_permission(auth.uid(), 'roles.read'));

create policy "Role managers have full access to role_permissions"
  on public.role_permissions for all
  using (public.user_has_permission(auth.uid(), 'roles.manage'))
  with check (public.user_has_permission(auth.uid(), 'roles.manage'));

create policy "Permitted staff can view role_permissions"
  on public.role_permissions for select
  using (public.user_has_permission(auth.uid(), 'roles.read'));

-- 6. Flip staff storage read policy.
drop policy if exists "Allow staff and admin read all patient files" on storage.objects;

create policy "Allow staff and admin read all patient files"
  on storage.objects for select
  using (
    bucket_id = 'patient-documents'
    and public.user_has_permission(auth.uid(), 'storage.patient_documents.read')
  );

-- 7. Keep patient-owned pending OCR policies unchanged; flip only admin cleanup.
drop policy if exists "Admins can clean up pending OCR rows" on public.pending_document_ocr;

create policy "Admins can clean up pending OCR rows"
  on public.pending_document_ocr for delete
  using (public.user_has_permission(auth.uid(), 'ocr_rows.manage.all'));

commit;
