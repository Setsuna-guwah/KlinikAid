-- KlinikAid Migration 15: Role-Based Access Control (RBAC) Schema Foundation
-- Additive only: creates permissions, roles, and role_permissions tables, adds nullable role_id FK to profiles.

-- 1. Create permissions table
CREATE TABLE IF NOT EXISTS public.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  description text,
  module text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- Enable RLS on permissions
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;

-- 2. Create roles table
CREATE TABLE IF NOT EXISTS public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- Enable RLS on roles
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

-- Enforce system role non-deletion
CREATE OR REPLACE FUNCTION public.prevent_system_role_deletion()
RETURNS trigger AS $$
BEGIN
  IF OLD.is_system THEN
    RAISE EXCEPTION 'Cannot delete system roles.';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_prevent_system_role_deletion
BEFORE DELETE ON public.roles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_system_role_deletion();

-- 3. Create role_permissions join table
CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_id uuid REFERENCES public.roles(id) ON DELETE CASCADE NOT NULL,
  permission_id uuid REFERENCES public.permissions(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (role_id, permission_id)
);

-- Enable RLS on role_permissions
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for new tables (admin-manage + staff-only reads)
CREATE POLICY "Admins have full access to permissions" ON public.permissions FOR ALL USING (public.get_auth_user_role() = 'admin');
CREATE POLICY "Staff can view permissions" ON public.permissions FOR SELECT USING (public.get_auth_user_role() IN ('admin', 'receptionist', 'department_staff', 'medical_specialist'));

CREATE POLICY "Admins have full access to roles" ON public.roles FOR ALL USING (public.get_auth_user_role() = 'admin');
CREATE POLICY "Staff can view roles" ON public.roles FOR SELECT USING (public.get_auth_user_role() IN ('admin', 'receptionist', 'department_staff', 'medical_specialist'));

CREATE POLICY "Admins have full access to role_permissions" ON public.role_permissions FOR ALL USING (public.get_auth_user_role() = 'admin');
CREATE POLICY "Staff can view role_permissions" ON public.role_permissions FOR SELECT USING (public.get_auth_user_role() IN ('admin', 'receptionist', 'department_staff', 'medical_specialist'));

-- 4. Add nullable role_id FK to profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES public.roles(id) ON DELETE SET NULL;

-- 5. Create permission verification resolver helper function
CREATE OR REPLACE FUNCTION public.user_has_permission(p_user_id uuid, p_permission_name text)
RETURNS boolean AS $$
DECLARE
  v_has_permission boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles pr
    JOIN public.role_permissions rp ON pr.role_id = rp.role_id
    JOIN public.permissions pe ON rp.permission_id = pe.id
    WHERE pr.id = p_user_id AND pe.name = p_permission_name
  ) INTO v_has_permission;
  
  RETURN COALESCE(v_has_permission, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Revoke public execution to secure the function
REVOKE EXECUTE ON FUNCTION public.user_has_permission(uuid, text) FROM anon;

-- 6. Seed permissions (catalog matches requested list)
INSERT INTO public.permissions (name, description, module) VALUES
  ('staff.manage', 'Create, update, and manage clinic personnel credentials and roles', 'staff'),
  ('profiles.manage', 'Full access to create, read, update, delete user profiles', 'profiles'),
  ('profiles.read_staff', 'View clinical and receptionist profiles', 'profiles'),
  ('patients.manage', 'Register and manage patients', 'patients'),
  ('patients.read', 'Search and view patient directory records', 'patients'),
  ('queue.manage', 'Route and update clinic department triage queues', 'queue'),
  ('queue.manage.own_dept', 'Manage triage queue for own department', 'queue'),
  ('queue.read', 'View active clinic triage queues', 'queue'),
  ('documents.manage', 'Approve, reject, and route patient documents', 'documents'),
  ('records.manage', 'Manage medical and diagnostic records', 'records'),
  ('records.manage.own_dept', 'Manage diagnostic records for own department', 'records'),
  ('system_logs.read', 'View audit logs', 'audit'),
  ('chatbot_logs.read', 'View chatbot conversations', 'audit'),
  ('rag_documents.manage', 'Update and configure RAG knowledge files', 'knowledge'),
  ('storage.patient_documents.read', 'Select access to patient-documents storage bucket objects', 'storage'),
  ('specialist.patients', 'Manage specialist patient list', 'specialist'),
  ('specialist.analytics', 'Access specialist analytic graphs', 'specialist'),
  ('specialist.records', 'Access specialist private record entry', 'specialist'),
  ('chat.access', 'Access the AI medical assistant chat console', 'patient'),
  ('ocr_rows.manage.own', 'Insert, read, or delete own pending OCR uploads', 'patient'),
  ('ocr_rows.manage.all', 'Clean up or manage any pending OCR upload rows', 'admin')
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  module = EXCLUDED.module;

-- 7. Seed system roles
INSERT INTO public.roles (name, description, is_system) VALUES
  ('admin', 'Administrator role with full clinic systems access', true),
  ('receptionist', 'Receptionist role for registration and document intake', true),
  ('department_staff', 'Clinical staff assigned to lab/imaging/ECG/ultrasound departments', true),
  ('medical_specialist', 'Doctors and specialists managing private patient cohorts', true),
  ('patient', 'Patient role for self-service actions', true)
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  is_system = EXCLUDED.is_system;

-- 8. Seed role_permissions join
DO $$
DECLARE
  v_role_id uuid;
  v_perm_id uuid;
  v_role_name text;
  v_perm_name text;
  v_mappings text[][] := ARRAY[
    -- Admin Mappings
    ['admin', 'staff.manage'],
    ['admin', 'profiles.manage'],
    ['admin', 'profiles.read_staff'],
    ['admin', 'patients.manage'],
    ['admin', 'queue.manage'],
    ['admin', 'documents.manage'],
    ['admin', 'records.manage'],
    ['admin', 'system_logs.read'],
    ['admin', 'chatbot_logs.read'],
    ['admin', 'rag_documents.manage'],
    ['admin', 'storage.patient_documents.read'],
    ['admin', 'chat.access'],
    ['admin', 'ocr_rows.manage.all'],
    -- Receptionist Mappings
    ['receptionist', 'profiles.read_staff'],
    ['receptionist', 'patients.manage'],
    ['receptionist', 'queue.manage'],
    ['receptionist', 'documents.manage'],
    ['receptionist', 'storage.patient_documents.read'],
    -- Department Staff Mappings
    ['department_staff', 'profiles.read_staff'],
    ['department_staff', 'patients.read'],
    ['department_staff', 'queue.manage.own_dept'],
    ['department_staff', 'records.manage.own_dept'],
    -- Medical Specialist Mappings
    ['medical_specialist', 'profiles.read_staff'],
    ['medical_specialist', 'queue.read'],
    ['medical_specialist', 'specialist.patients'],
    ['medical_specialist', 'specialist.analytics'],
    ['medical_specialist', 'specialist.records'],
    -- Patient Mappings
    ['patient', 'chat.access'],
    ['patient', 'ocr_rows.manage.own']
  ];
BEGIN
  FOR i IN 1..array_length(v_mappings, 1) LOOP
    v_role_name := v_mappings[i][1];
    v_perm_name := v_mappings[i][2];

    SELECT id INTO v_role_id FROM public.roles WHERE name = v_role_name;
    SELECT id INTO v_perm_id FROM public.permissions WHERE name = v_perm_name;

    IF v_role_id IS NOT NULL AND v_perm_id IS NOT NULL THEN
      INSERT INTO public.role_permissions (role_id, permission_id)
      VALUES (v_role_id, v_perm_id)
      ON CONFLICT (role_id, permission_id) DO NOTHING;
    END IF;
  END LOOP;
END;
$$;

-- 9. Backfill role_id to existing profiles
UPDATE public.profiles p
SET role_id = r.id
FROM public.roles r
WHERE p.role = r.name;
