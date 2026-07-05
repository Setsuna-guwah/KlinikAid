-- KlinikAid Migration 12: Specialist Private Workspace (Model A)
-- Creates private patients and records tables under strict owner-only RLS (admin excluded)

CREATE TABLE IF NOT EXISTS public.specialist_patients (
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
  updated_at timestamptz DEFAULT timezone('utc', now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.specialist_records (
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
  updated_at timestamptz DEFAULT timezone('utc', now()) NOT NULL
);

-- Enable Row Level Security
ALTER TABLE public.specialist_patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.specialist_records ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any (safeguard)
DROP POLICY IF EXISTS "Specialist manages own patients" ON public.specialist_patients;
DROP POLICY IF EXISTS "Specialist manages own records" ON public.specialist_records;

-- Owner-only RLS policies
CREATE POLICY "Specialist manages own patients"
  ON public.specialist_patients FOR ALL
  USING (specialist_id = auth.uid())
  WITH CHECK (specialist_id = auth.uid());

CREATE POLICY "Specialist manages own records"
  ON public.specialist_records FOR ALL
  USING (specialist_id = auth.uid())
  WITH CHECK (specialist_id = auth.uid());
