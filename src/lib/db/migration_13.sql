-- KlinikAid Migration 13: Pending OCR assessment table for patient submit quality warnings
-- Additive only: no existing table or constraint changes.

CREATE TABLE IF NOT EXISTS public.pending_document_ocr (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_type text NOT NULL,
  file_path text NOT NULL,
  ocr_text text NOT NULL DEFAULT '',
  prompt_token_count integer,
  candidates_token_count integer,
  total_token_count integer,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_pending_document_ocr_user_created
  ON public.pending_document_ocr(user_id, created_at);

ALTER TABLE public.pending_document_ocr ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Patients can insert own pending OCR rows" ON public.pending_document_ocr;
DROP POLICY IF EXISTS "Patients can read own pending OCR rows" ON public.pending_document_ocr;
DROP POLICY IF EXISTS "Patients can delete own pending OCR rows" ON public.pending_document_ocr;
DROP POLICY IF EXISTS "Admins can clean up pending OCR rows" ON public.pending_document_ocr;

CREATE POLICY "Patients can insert own pending OCR rows"
  ON public.pending_document_ocr FOR INSERT
  WITH CHECK (
    public.get_auth_user_role() = 'patient' AND
    auth.uid() = user_id
  );

CREATE POLICY "Patients can read own pending OCR rows"
  ON public.pending_document_ocr FOR SELECT
  USING (
    public.get_auth_user_role() = 'patient' AND
    auth.uid() = user_id
  );

CREATE POLICY "Patients can delete own pending OCR rows"
  ON public.pending_document_ocr FOR DELETE
  USING (
    public.get_auth_user_role() = 'patient' AND
    auth.uid() = user_id
  );

CREATE POLICY "Admins can clean up pending OCR rows"
  ON public.pending_document_ocr FOR DELETE
  USING (public.get_auth_user_role() = 'admin');

-- Periodic cleanup target for scheduled/manual execution:
-- DELETE FROM public.pending_document_ocr
-- WHERE created_at < timezone('utc', now()) - interval '24 hours';
