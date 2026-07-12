-- KlinikAid Migration 14: Staff employee type display title
-- Additive only: no auth/RLS role changes.
-- Stale department audit result before build: 0 rows, so no corrective UPDATE is included.

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS employee_type text;
