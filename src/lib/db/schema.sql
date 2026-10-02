-- KlinikAid Database Schema (Supabase PostgreSQL)
-- Target DB: Supabase Postgres
-- Supports pgvector for RAG chatbot
--
-- ===========================================================================
-- WARNING: DESTRUCTIVE RESET SCRIPT. Line 20 drops public.profiles CASCADE.
-- Never run this against a database holding real data.
--
-- NOT RUNNABLE STANDALONE. This file is a dev bootstrap that absorbs app-feature
-- migrations, but it has absorbed only some of the RBAC era. It references
-- public.user_has_permission() (18 policy calls) and public.profiles.role_id,
-- and neither is defined below. To rebuild a database from scratch, run this
-- file and then apply every migration in src/lib/db/ in order:
--     migration_07.sql ... migration_22.sql
-- The migration files are the source of truth for what the live database
-- actually contains; this file is documentation and a partial starting point.
-- Known still-absent here: match_documents() (m07), the patient-documents
-- storage bucket and its policies (m09), pending_document_ocr (m13), and the
-- whole RBAC catalog -- permissions/roles/role_permissions tables, the
-- role_id column, user_has_permission(), and the seed data (m15, m16).
-- ===========================================================================

-- Enable the pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- Drop existing tables (in order of dependencies)
DROP TABLE IF EXISTS public.rag_documents CASCADE;
DROP TABLE IF EXISTS public.chatbot_logs CASCADE;
DROP TABLE IF EXISTS public.system_logs CASCADE;
DROP TABLE IF EXISTS public.department_records CASCADE;
DROP TABLE IF EXISTS public.documents CASCADE;
DROP TABLE IF EXISTS public.patient_queue CASCADE;
DROP TABLE IF EXISTS public.patients CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

-- 1. Profiles Table (extends auth.users)
CREATE TABLE public.profiles (
  id uuid REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  full_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'receptionist', 'department_staff', 'medical_specialist', 'patient')),
  department text CHECK (department IN ('laboratory', 'imaging', 'ultrasound', 'ecg')),
  employee_type text,
  is_active boolean DEFAULT true NOT NULL,
  accepted_privacy_at timestamp with time zone NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Patients Table
CREATE TABLE public.patients (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  date_of_birth date NOT NULL,
  gender text NOT NULL CHECK (gender IN ('male', 'female', 'other')),
  contact_number text NOT NULL,
  email text,
  address text NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Patient Queue Table
CREATE TABLE public.patient_queue (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id uuid REFERENCES public.patients(id) ON DELETE CASCADE NOT NULL,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'in_progress', 'completed', 'cancelled')),
  department text NOT NULL CHECK (department IN ('laboratory', 'imaging', 'ultrasound', 'ecg')),
  triage_notes text,
  priority_level text NOT NULL DEFAULT 'routine' CHECK (priority_level IN ('routine', 'urgent', 'emergency')),
  estimated_wait_minutes integer,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Documents Table (patient submissions for approval)
CREATE TABLE public.documents (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id uuid REFERENCES public.patients(id) ON DELETE CASCADE,
  uploader_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL NOT NULL,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  ocr_text text,
  extracted_metadata jsonb,
  rejection_reason text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Department Records Table (lab results / imaging files)
CREATE TABLE public.department_records (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id uuid REFERENCES public.patients(id) ON DELETE CASCADE NOT NULL,
  recorder_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL NOT NULL,
  department text NOT NULL CHECK (department IN ('laboratory', 'imaging', 'ultrasound', 'ecg')),
  test_type text NOT NULL,
  test_name text NOT NULL,
  test_value text NOT NULL,
  unit text,
  reference_range_min numeric,
  reference_range_max numeric,
  is_flagged boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


-- 6. System Logs Table (Audit trail)
CREATE TABLE public.system_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  description text NOT NULL,
  ip_address text,
  metadata jsonb,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 7. Chatbot Logs Table
CREATE TABLE public.chatbot_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  user_message text NOT NULL,
  bot_response text NOT NULL,
  tokens_used integer DEFAULT 0 NOT NULL,
  feedback text CHECK (feedback IN ('helpful', 'unhelpful')),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 8. RAG Documents Table
CREATE TABLE public.rag_documents (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  content text NOT NULL,
  embedding vector(768) NOT NULL,
  metadata jsonb,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create index for vector search (Cosine distance)
CREATE INDEX ON public.rag_documents USING hnsw (embedding vector_cosine_ops);

-- Enable Row Level Security (RLS) on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.department_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chatbot_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rag_documents ENABLE ROW LEVEL SECURITY;

-- Helper functions for RLS checks (prevents recursion)
CREATE OR REPLACE FUNCTION public.get_auth_user_role()
RETURNS text AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.get_auth_user_dept()
RETURNS text AS $$
  SELECT department FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

-- =========================================================================
-- RLS POLICIES
-- =========================================================================

-- 1. Profiles Table Policies
CREATE POLICY "Admins have full access to profiles" 
  ON public.profiles FOR ALL 
  USING (public.user_has_permission(auth.uid(), 'profiles.manage'))
  WITH CHECK (public.user_has_permission(auth.uid(), 'profiles.manage'));

CREATE POLICY "Users can read own profile" 
  ON public.profiles FOR SELECT 
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile details" 
  ON public.profiles FOR UPDATE 
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    -- IS NOT DISTINCT FROM, not =, so a NULL held by a NULL-holder stays legal
    -- while a change from NULL to a real value is still blocked.
    AND role        IS NOT DISTINCT FROM (SELECT p.role        FROM public.profiles p WHERE p.id = auth.uid())
    AND role_id     IS NOT DISTINCT FROM (SELECT p.role_id     FROM public.profiles p WHERE p.id = auth.uid())
    AND department  IS NOT DISTINCT FROM (SELECT p.department  FROM public.profiles p WHERE p.id = auth.uid())
    AND is_active   IS NOT DISTINCT FROM (SELECT p.is_active   FROM public.profiles p WHERE p.id = auth.uid())
  ); -- block role, role_id, department and is_active hijacking

-- Privileged columns stay writable by staff who actually hold profiles.manage,
-- which is what the admin routes rely on.
CREATE POLICY "Users with profiles.manage can update any profile" 
  ON public.profiles FOR UPDATE 
  TO authenticated
  USING (public.user_has_permission(auth.uid(), 'profiles.manage'))
  WITH CHECK (public.user_has_permission(auth.uid(), 'profiles.manage'));

CREATE POLICY "Clinic staff can view all profiles" 
  ON public.profiles FOR SELECT 
  USING (public.user_has_permission(auth.uid(), 'profiles.read_staff'));

-- 2. Patients Table Policies
CREATE POLICY "Admins have full access to patients" 
  ON public.patients FOR ALL 
  USING (public.user_has_permission(auth.uid(), 'patients.manage'))
  WITH CHECK (public.user_has_permission(auth.uid(), 'patients.manage'));

CREATE POLICY "Receptionists can manage patients" 
  ON public.patients FOR ALL 
  USING (public.user_has_permission(auth.uid(), 'patients.manage'))
  WITH CHECK (public.user_has_permission(auth.uid(), 'patients.manage'));

CREATE POLICY "Staff can view all patients" 
  ON public.patients FOR SELECT 
  USING (public.user_has_permission(auth.uid(), 'patients.read'));

CREATE POLICY "Patients can view own patient record" 
  ON public.patients FOR SELECT 
  USING (profile_id = auth.uid());

CREATE POLICY "Patients can update own details" 
  ON public.patients FOR UPDATE 
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

-- 3. Patient Queue Policies
CREATE POLICY "Admins have full access to queue" 
  ON public.patient_queue FOR ALL 
  USING (public.user_has_permission(auth.uid(), 'queue.manage'))
  WITH CHECK (public.user_has_permission(auth.uid(), 'queue.manage'));

CREATE POLICY "Receptionists can manage queue" 
  ON public.patient_queue FOR ALL 
  USING (public.user_has_permission(auth.uid(), 'queue.manage'))
  WITH CHECK (public.user_has_permission(auth.uid(), 'queue.manage'));

CREATE POLICY "Department staff can view and update queue for their department" 
  ON public.patient_queue FOR ALL 
  USING (
    public.user_has_permission(auth.uid(), 'queue.manage.own_dept') AND 
    department = public.get_auth_user_dept()
  )
  WITH CHECK (
    public.user_has_permission(auth.uid(), 'queue.manage.own_dept') AND 
    department = public.get_auth_user_dept()
  );

CREATE POLICY "Medical specialists can view queue" 
  ON public.patient_queue FOR SELECT 
  USING (public.user_has_permission(auth.uid(), 'queue.read'));

CREATE POLICY "Patients can view own queue entries" 
  ON public.patient_queue FOR SELECT 
  USING (patient_id IN (SELECT id FROM public.patients WHERE profile_id = auth.uid()));

-- 4. Documents Table Policies
CREATE POLICY "Admins have full access to documents" 
  ON public.documents FOR ALL 
  USING (public.user_has_permission(auth.uid(), 'documents.manage'))
  WITH CHECK (public.user_has_permission(auth.uid(), 'documents.manage'));

CREATE POLICY "Receptionists can view and update documents" 
  ON public.documents FOR ALL 
  USING (public.user_has_permission(auth.uid(), 'documents.manage'))
  WITH CHECK (public.user_has_permission(auth.uid(), 'documents.manage'));

CREATE POLICY "Patients can view own documents" 
  ON public.documents FOR SELECT 
  USING (uploader_id = auth.uid() OR patient_id IN (SELECT id FROM public.patients WHERE profile_id = auth.uid()));

CREATE POLICY "Patients can insert own documents" 
  ON public.documents FOR INSERT 
  WITH CHECK (uploader_id = auth.uid());

CREATE POLICY "Patients can update own pending documents" 
  ON public.documents FOR UPDATE 
  USING (uploader_id = auth.uid() AND status = 'pending')
  WITH CHECK (uploader_id = auth.uid() AND status = 'pending');

CREATE POLICY "Patients can delete own pending documents"
  ON public.documents FOR DELETE
  USING (uploader_id = auth.uid() AND status = 'pending');

-- 5. Department Records Policies (Enforces Isolation SO-D)
CREATE POLICY "Admins have full access to department records" 
  ON public.department_records FOR ALL 
  USING (public.user_has_permission(auth.uid(), 'records.manage'))
  WITH CHECK (public.user_has_permission(auth.uid(), 'records.manage'));

CREATE POLICY "Department staff can only view/insert/update within their own department" 
  ON public.department_records FOR ALL 
  USING (
    public.user_has_permission(auth.uid(), 'records.manage.own_dept') AND 
    department = public.get_auth_user_dept()
  )
  WITH CHECK (
    public.user_has_permission(auth.uid(), 'records.manage.own_dept') AND 
    department = public.get_auth_user_dept()
  );


CREATE POLICY "Patients can view only their own department records" 
  ON public.department_records FOR SELECT 
  USING (patient_id IN (SELECT id FROM public.patients WHERE profile_id = auth.uid()));

-- 6. System Logs Policies
CREATE POLICY "Admins can view system logs" 
  ON public.system_logs FOR SELECT 
  USING (public.user_has_permission(auth.uid(), 'system_logs.read'));

CREATE POLICY "Authenticated users can insert system logs" 
  ON public.system_logs FOR INSERT 
  WITH CHECK (auth.uid() IS NOT NULL);

-- 7. Chatbot Logs Policies
CREATE POLICY "Admins can view chatbot logs" 
  ON public.chatbot_logs FOR SELECT 
  USING (public.user_has_permission(auth.uid(), 'chatbot_logs.read'));

CREATE POLICY "Users can view and insert own chatbot logs" 
  ON public.chatbot_logs FOR ALL 
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 8. RAG Documents Policies
CREATE POLICY "Anyone can read RAG documents" 
  ON public.rag_documents FOR SELECT 
  USING (true);

CREATE POLICY "Admins can manage RAG documents" 
  ON public.rag_documents FOR ALL 
  USING (public.user_has_permission(auth.uid(), 'rag_documents.manage'))
  WITH CHECK (public.user_has_permission(auth.uid(), 'rag_documents.manage'));

-- =========================================================================
-- PROFILE AUTOMATION TRIGGER
-- =========================================================================

-- Trigger to automatically create a public.profile upon auth.users signup.
-- Self-service signup is always provisioned as 'patient': raw_user_meta_data is
-- caller-writable, so a claimed role is logged and ignored rather than honoured.
-- Staff roles are assigned by the server after account creation.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  default_name text;
  claimed_role text;
  patient_role_id uuid;
BEGIN
  default_name := COALESCE(new.raw_user_meta_data->>'full_name', 'New User');
  claimed_role := COALESCE(
    new.raw_user_meta_data->>'role',
    new.raw_app_meta_data->>'role'
  );

  SELECT id INTO patient_role_id
  FROM public.roles
  WHERE name = 'patient';

  IF patient_role_id IS NULL THEN
    BEGIN
      INSERT INTO public.system_logs (user_id, event_type, description, metadata)
      VALUES (new.id, 'PROFILE_PROVISIONING_FAILED',
        'Profile provisioning failed: patient role_id could not be resolved',
        jsonb_build_object('reason', 'missing_patient_role_id'));
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    RAISE EXCEPTION 'Profile provisioning failed: patient role_id could not be resolved';
  END IF;

  -- Self-service signup is always a patient. Staff role is assigned by the
  -- server after creation, never from anything the caller supplied.
  INSERT INTO public.profiles (id, full_name, role, department, role_id)
  VALUES (new.id, default_name, 'patient', NULL, patient_role_id);

  BEGIN
    -- A signup that tried to claim a role is now expected traffic from any
    -- scanner, but it is worth a durable record rather than a silent drop.
    IF claimed_role IS NOT NULL AND claimed_role <> 'patient' THEN
      INSERT INTO public.system_logs (user_id, event_type, description, metadata)
      VALUES (new.id, 'SIGNUP_ROLE_CLAIM_IGNORED',
        'Signup supplied a privileged role that was not honoured; provisioned as patient',
        jsonb_build_object('claimed_role', claimed_role, 'granted_role', 'patient'));
    END IF;

    INSERT INTO public.system_logs (user_id, event_type, description, metadata)
    VALUES (new.id, 'USER_REGISTERED',
      'User account created automatically: ' || default_name || ' (patient)',
      jsonb_build_object('role', 'patient', 'department', NULL, 'role_id', patient_role_id));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN new;
EXCEPTION
  WHEN OTHERS THEN
    BEGIN
      INSERT INTO public.system_logs (user_id, event_type, description, metadata)
      VALUES (new.id, 'PROFILE_PROVISIONING_FAILED',
        'Profile provisioning failed during signup trigger',
        jsonb_build_object('error', sqlerrm));
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Daily token usage aggregation function
CREATE OR REPLACE FUNCTION public.get_daily_token_usage(start_date TIMESTAMPTZ)
RETURNS TABLE(date DATE, total_tokens BIGINT, query_count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DATE(created_at AT TIME ZONE 'Asia/Manila') AS date,
         COALESCE(SUM(tokens_used), 0)::BIGINT        AS total_tokens,
         COUNT(*)::BIGINT                            AS query_count
  FROM   public.chatbot_logs
  WHERE  created_at >= start_date
  GROUP  BY DATE(created_at AT TIME ZONE 'Asia/Manila')
  ORDER  BY date ASC;
$$;

-- Restrict execution to authenticated users and service role
REVOKE EXECUTE ON FUNCTION public.get_daily_token_usage(TIMESTAMPTZ) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_token_usage(TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_token_usage(TIMESTAMPTZ) TO service_role;

-- Index for session-based chatbot log retrieval
CREATE INDEX IF NOT EXISTS idx_chatbot_logs_session_id ON public.chatbot_logs(session_id);


-- =========================================================================
-- SPECIALIST PRIVATE DATA (Model A)
-- =========================================================================

-- Specialist private patients
CREATE TABLE public.specialist_patients (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  specialist_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  date_of_birth date NOT NULL,
  gender text NOT NULL CHECK (gender IN ('male', 'female', 'other')),
  contact_number text,
  email text,
  address text,
  created_at timestamptz DEFAULT timezone('utc', now()) NOT NULL,
  updated_at timestamptz DEFAULT timezone('utc', now()) NOT NULL,
  deleted_at timestamptz
);

-- Specialist private records
CREATE TABLE public.specialist_records (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  specialist_patient_id uuid REFERENCES public.specialist_patients(id) ON DELETE CASCADE NOT NULL,
  specialist_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL NOT NULL,
  test_type text NOT NULL,
  test_name text NOT NULL,
  test_value text NOT NULL,
  unit text,
  reference_range_min numeric,
  reference_range_max numeric,
  is_flagged boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz DEFAULT timezone('utc', now()) NOT NULL,
  updated_at timestamptz DEFAULT timezone('utc', now()) NOT NULL,
  deleted_at timestamptz
);

-- Enable Row Level Security
ALTER TABLE public.specialist_patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.specialist_records ENABLE ROW LEVEL SECURITY;

-- Policies are split per command rather than kept as FOR ALL, mirroring
-- migration_22. FOR ALL includes DELETE, which is exactly the defect migration_22
-- closed: specialist_records.specialist_patient_id is ON DELETE CASCADE, so a
-- permitted DELETE destroyed a patient's entire diagnostic history with no audit
-- trail. No FOR DELETE policy is created here either, so a specialist delete is
-- refused by RLS and only the service role can remove a row.
--
-- SELECT hides archived rows; UPDATE is deliberately unconstrained on deleted_at
-- so archiving is permitted. The archive itself runs through
-- archive_specialist_patient(), SECURITY DEFINER, because PostgreSQL re-applies
-- a SELECT policy's USING to the new row of an UPDATE, so a plain UPDATE setting
-- deleted_at would violate the very `deleted_at IS NULL` clause that hides
-- archived rows. That function is defined by migration_22's addendum.
CREATE POLICY "Specialist reads own active patients"
  ON public.specialist_patients FOR SELECT
  TO authenticated
  USING (public.user_has_permission(auth.uid(), 'specialist.patients') AND specialist_id = auth.uid() AND deleted_at IS NULL);

CREATE POLICY "Specialist creates own patients"
  ON public.specialist_patients FOR INSERT
  TO authenticated
  WITH CHECK (public.user_has_permission(auth.uid(), 'specialist.patients') AND specialist_id = auth.uid() AND deleted_at IS NULL);

CREATE POLICY "Specialist updates own patients"
  ON public.specialist_patients FOR UPDATE
  TO authenticated
  USING (public.user_has_permission(auth.uid(), 'specialist.patients') AND specialist_id = auth.uid())
  WITH CHECK (public.user_has_permission(auth.uid(), 'specialist.patients') AND specialist_id = auth.uid());

CREATE POLICY "Specialist reads own active records"
  ON public.specialist_records FOR SELECT
  TO authenticated
  USING (public.user_has_permission(auth.uid(), 'specialist.records') AND specialist_id = auth.uid() AND deleted_at IS NULL);

CREATE POLICY "Specialist creates own records"
  ON public.specialist_records FOR INSERT
  TO authenticated
  WITH CHECK (public.user_has_permission(auth.uid(), 'specialist.records') AND specialist_id = auth.uid() AND deleted_at IS NULL);

CREATE POLICY "Specialist updates own records"
  ON public.specialist_records FOR UPDATE
  TO authenticated
  USING (public.user_has_permission(auth.uid(), 'specialist.records') AND specialist_id = auth.uid())
  WITH CHECK (public.user_has_permission(auth.uid(), 'specialist.records') AND specialist_id = auth.uid());
