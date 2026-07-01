-- KlinikAid Migration 11: Patient DELETE policy for own pending documents
-- Fixes #19 - replaces service-role delete workaround with DB-enforced RLS

CREATE POLICY "Patients can delete own pending documents"
  ON public.documents FOR DELETE
  USING (uploader_id = auth.uid() AND status = 'pending');
