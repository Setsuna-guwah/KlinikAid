-- KlinikAid Migration 16: base_role column on roles (custom-role → template resolution for old-path enforcement)
-- Additive only: nullable column, no RLS/auth changes.
ALTER TABLE public.roles
ADD COLUMN IF NOT EXISTS base_role text CHECK (base_role IN ('admin', 'receptionist', 'department_staff', 'medical_specialist', 'patient'));
