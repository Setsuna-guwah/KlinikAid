-- KlinikAid Migration 43: evaluate RLS auth calls once per statement (#235)
-- Why: a bare auth.uid(), get_auth_user_role() or get_auth_user_dept() inside a
-- policy is re-evaluated for every candidate row. user_has_permission is a
-- SECURITY DEFINER join over three tables, so counting system_logs as an admin
-- took 820 ms in the database. Wrapped as (select ...), each call becomes an
-- InitPlan that runs once per statement (1.5 ms for the same count, per #235).
--
-- What changes: each of the 51 policies (47 in public, 4 on storage.objects) is
-- dropped and recreated under the same name with the same command, roles,
-- USING and WITH CHECK. Only the call sites change, to
--   (select public.user_has_permission((select auth.uid()), 'x'))
--   (select auth.uid())
--   (select public.get_auth_user_role()) / (select public.get_auth_user_dept())
-- get_auth_user_dept() is not named in the issue but has the same per-row cost.
-- Source: live pg_policies, which matched schema.sql through migration_42 exactly.
--
-- Not changed: function volatility and bodies (a STABLE marking is unnecessary
-- once the call is an InitPlan, and would change how a function sees rows its own
-- statement is writing), grants, policy names, and RLS enablement.
-- Idempotent: each policy is dropped with IF EXISTS before its CREATE, and the
-- file runs as one transaction, so a failure leaves the old policies in place.
-- ORDERING: independent of 42 and newer; apply after merge, before regenerating
-- schema.sql. Code does not depend on it, so deploying first is safe.
-- VERIFY: tools/perf/rls-policy-diff.mjs compares the policy set and expressions
-- before and after in a throwaway Postgres and checks the InitPlan in the plan.
-- SNAPSHOT: written but not applied; do not regenerate schema.sql until applied.
-- ROLLBACK: re-create the previous definitions from schema.sql (through 42).
-- Access results do not change, so no data is affected either way.

begin;

DROP POLICY IF EXISTS "Admins can view chatbot logs" ON public.chatbot_logs;
CREATE POLICY "Admins can view chatbot logs" ON public.chatbot_logs
  FOR SELECT
  USING ((select public.user_has_permission((select auth.uid()), 'chatbot_logs.read'::text)));

DROP POLICY IF EXISTS "Users can view and insert own chatbot logs" ON public.chatbot_logs;
CREATE POLICY "Users can view and insert own chatbot logs" ON public.chatbot_logs
  FOR ALL
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));

DROP POLICY IF EXISTS "Admins have full access to department records" ON public.department_records;
CREATE POLICY "Admins have full access to department records" ON public.department_records
  FOR ALL
  USING ((select public.user_has_permission((select auth.uid()), 'records.manage'::text)))
  WITH CHECK ((select public.user_has_permission((select auth.uid()), 'records.manage'::text)));

DROP POLICY IF EXISTS "Department staff can only view/insert/update within their own d" ON public.department_records;
CREATE POLICY "Department staff can only view/insert/update within their own d" ON public.department_records
  FOR ALL
  USING (((select public.user_has_permission((select auth.uid()), 'records.manage.own_dept'::text)) AND (department = (select public.get_auth_user_dept()))))
  WITH CHECK (((select public.user_has_permission((select auth.uid()), 'records.manage.own_dept'::text)) AND (department = (select public.get_auth_user_dept()))));

DROP POLICY IF EXISTS "Medical specialists can read all department records" ON public.department_records;
CREATE POLICY "Medical specialists can read all department records" ON public.department_records
  FOR SELECT
  USING (((select public.get_auth_user_role()) = 'medical_specialist'::text));

DROP POLICY IF EXISTS "Patients can view only their own department records" ON public.department_records;
CREATE POLICY "Patients can view only their own department records" ON public.department_records
  FOR SELECT
  USING ((patient_id IN ( SELECT patients.id FROM patients WHERE (patients.profile_id = (select auth.uid())))));

DROP POLICY IF EXISTS "Admins have full access to documents" ON public.documents;
CREATE POLICY "Admins have full access to documents" ON public.documents
  FOR ALL
  USING ((select public.user_has_permission((select auth.uid()), 'documents.manage'::text)))
  WITH CHECK ((select public.user_has_permission((select auth.uid()), 'documents.manage'::text)));

DROP POLICY IF EXISTS "Patients can delete own pending documents" ON public.documents;
CREATE POLICY "Patients can delete own pending documents" ON public.documents
  FOR DELETE
  USING (((uploader_id = (select auth.uid())) AND (status = 'pending'::text)));

DROP POLICY IF EXISTS "Patients can view own documents" ON public.documents;
CREATE POLICY "Patients can view own documents" ON public.documents
  FOR SELECT
  USING (((uploader_id = (select auth.uid())) OR (patient_id IN ( SELECT patients.id FROM patients WHERE (patients.profile_id = (select auth.uid()))))));

DROP POLICY IF EXISTS "Receptionists can view and update documents" ON public.documents;
CREATE POLICY "Receptionists can view and update documents" ON public.documents
  FOR ALL
  USING ((select public.user_has_permission((select auth.uid()), 'documents.manage'::text)))
  WITH CHECK ((select public.user_has_permission((select auth.uid()), 'documents.manage'::text)));

DROP POLICY IF EXISTS "Authenticated users can read lab plausibility limits" ON public.lab_plausibility_limits;
CREATE POLICY "Authenticated users can read lab plausibility limits" ON public.lab_plausibility_limits
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins have full access to queue" ON public.patient_queue;
CREATE POLICY "Admins have full access to queue" ON public.patient_queue
  FOR ALL
  USING ((select public.user_has_permission((select auth.uid()), 'queue.manage'::text)))
  WITH CHECK ((select public.user_has_permission((select auth.uid()), 'queue.manage'::text)));

DROP POLICY IF EXISTS "Department staff can view and update queue for their department" ON public.patient_queue;
CREATE POLICY "Department staff can view and update queue for their department" ON public.patient_queue
  FOR ALL
  USING (((select public.user_has_permission((select auth.uid()), 'queue.manage.own_dept'::text)) AND (department = (select public.get_auth_user_dept()))))
  WITH CHECK (((select public.user_has_permission((select auth.uid()), 'queue.manage.own_dept'::text)) AND (department = (select public.get_auth_user_dept()))));

DROP POLICY IF EXISTS "Medical specialists can view queue" ON public.patient_queue;
CREATE POLICY "Medical specialists can view queue" ON public.patient_queue
  FOR SELECT
  USING ((select public.user_has_permission((select auth.uid()), 'queue.read'::text)));

DROP POLICY IF EXISTS "Patients can view own queue entries" ON public.patient_queue;
CREATE POLICY "Patients can view own queue entries" ON public.patient_queue
  FOR SELECT
  USING ((patient_id IN ( SELECT patients.id FROM patients WHERE (patients.profile_id = (select auth.uid())))));

DROP POLICY IF EXISTS "Receptionists can manage queue" ON public.patient_queue;
CREATE POLICY "Receptionists can manage queue" ON public.patient_queue
  FOR ALL
  USING ((select public.user_has_permission((select auth.uid()), 'queue.manage'::text)))
  WITH CHECK ((select public.user_has_permission((select auth.uid()), 'queue.manage'::text)));

DROP POLICY IF EXISTS "Admins have full access to patients" ON public.patients;
CREATE POLICY "Admins have full access to patients" ON public.patients
  FOR ALL
  USING ((select public.user_has_permission((select auth.uid()), 'patients.manage'::text)))
  WITH CHECK ((select public.user_has_permission((select auth.uid()), 'patients.manage'::text)));

DROP POLICY IF EXISTS "Patients can insert own patient record" ON public.patients;
CREATE POLICY "Patients can insert own patient record" ON public.patients
  FOR INSERT
  WITH CHECK ((profile_id = (select auth.uid())));

DROP POLICY IF EXISTS "Patients can update own details" ON public.patients;
CREATE POLICY "Patients can update own details" ON public.patients
  FOR UPDATE
  USING ((profile_id = (select auth.uid())))
  WITH CHECK ((profile_id = (select auth.uid())));

DROP POLICY IF EXISTS "Patients can view own patient record" ON public.patients;
CREATE POLICY "Patients can view own patient record" ON public.patients
  FOR SELECT
  USING ((profile_id = (select auth.uid())));

DROP POLICY IF EXISTS "Receptionists can manage patients" ON public.patients;
CREATE POLICY "Receptionists can manage patients" ON public.patients
  FOR ALL
  USING ((select public.user_has_permission((select auth.uid()), 'patients.manage'::text)))
  WITH CHECK ((select public.user_has_permission((select auth.uid()), 'patients.manage'::text)));

DROP POLICY IF EXISTS "Staff and specialists can view all patients" ON public.patients;
CREATE POLICY "Staff and specialists can view all patients" ON public.patients
  FOR SELECT
  USING (((select public.get_auth_user_role()) = ANY (ARRAY['department_staff'::text, 'medical_specialist'::text])));

DROP POLICY IF EXISTS "Staff can view all patients" ON public.patients;
CREATE POLICY "Staff can view all patients" ON public.patients
  FOR SELECT
  USING ((select public.user_has_permission((select auth.uid()), 'patients.read'::text)));

DROP POLICY IF EXISTS "Admins can clean up pending OCR rows" ON public.pending_document_ocr;
CREATE POLICY "Admins can clean up pending OCR rows" ON public.pending_document_ocr
  FOR DELETE
  USING ((select public.user_has_permission((select auth.uid()), 'ocr_rows.manage.all'::text)));

DROP POLICY IF EXISTS "Patients can delete own pending OCR rows" ON public.pending_document_ocr;
CREATE POLICY "Patients can delete own pending OCR rows" ON public.pending_document_ocr
  FOR DELETE
  USING ((((select public.get_auth_user_role()) = 'patient'::text) AND ((select auth.uid()) = user_id)));

DROP POLICY IF EXISTS "Patients can insert own pending OCR rows" ON public.pending_document_ocr;
CREATE POLICY "Patients can insert own pending OCR rows" ON public.pending_document_ocr
  FOR INSERT
  WITH CHECK ((((select public.get_auth_user_role()) = 'patient'::text) AND ((select auth.uid()) = user_id)));

DROP POLICY IF EXISTS "Patients can read own pending OCR rows" ON public.pending_document_ocr;
CREATE POLICY "Patients can read own pending OCR rows" ON public.pending_document_ocr
  FOR SELECT
  USING ((((select public.get_auth_user_role()) = 'patient'::text) AND ((select auth.uid()) = user_id)));

DROP POLICY IF EXISTS "Permitted staff can view permissions" ON public.permissions;
CREATE POLICY "Permitted staff can view permissions" ON public.permissions
  FOR SELECT
  USING ((select public.user_has_permission((select auth.uid()), 'roles.read'::text)));

DROP POLICY IF EXISTS "Role managers have full access to permissions" ON public.permissions;
CREATE POLICY "Role managers have full access to permissions" ON public.permissions
  FOR ALL
  USING ((select public.user_has_permission((select auth.uid()), 'roles.manage'::text)))
  WITH CHECK ((select public.user_has_permission((select auth.uid()), 'roles.manage'::text)));

DROP POLICY IF EXISTS "Admins have full access to profiles" ON public.profiles;
CREATE POLICY "Admins have full access to profiles" ON public.profiles
  FOR ALL
  USING ((select public.user_has_permission((select auth.uid()), 'profiles.manage'::text)))
  WITH CHECK ((select public.user_has_permission((select auth.uid()), 'profiles.manage'::text)));

DROP POLICY IF EXISTS "Clinic staff can view all profiles" ON public.profiles;
CREATE POLICY "Clinic staff can view all profiles" ON public.profiles
  FOR SELECT
  USING ((select public.user_has_permission((select auth.uid()), 'profiles.read_staff'::text)));

DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
CREATE POLICY "Users can read own profile" ON public.profiles
  FOR SELECT
  USING (((select auth.uid()) = id));

DROP POLICY IF EXISTS "Users can update own profile details" ON public.profiles;
CREATE POLICY "Users can update own profile details" ON public.profiles
  FOR UPDATE
  TO authenticated
  USING ((((select auth.uid()) = id) AND (is_active IS TRUE)))
  WITH CHECK ((((select auth.uid()) = id) AND (NOT (role IS DISTINCT FROM ( SELECT p.role FROM profiles p WHERE (p.id = (select auth.uid()))))) AND (NOT (role_id IS DISTINCT FROM ( SELECT p.role_id FROM profiles p WHERE (p.id = (select auth.uid()))))) AND (NOT (department IS DISTINCT FROM ( SELECT p.department FROM profiles p WHERE (p.id = (select auth.uid()))))) AND (NOT (is_active IS DISTINCT FROM ( SELECT p.is_active FROM profiles p WHERE (p.id = (select auth.uid()))))) AND (NOT (email_verified_at IS DISTINCT FROM ( SELECT p.email_verified_at FROM profiles p WHERE (p.id = (select auth.uid())))))));

DROP POLICY IF EXISTS "Users with profiles.manage can update any profile" ON public.profiles;
CREATE POLICY "Users with profiles.manage can update any profile" ON public.profiles
  FOR UPDATE
  TO authenticated
  USING ((select public.user_has_permission((select auth.uid()), 'profiles.manage'::text)))
  WITH CHECK ((select public.user_has_permission((select auth.uid()), 'profiles.manage'::text)));

DROP POLICY IF EXISTS "Admins can manage RAG documents" ON public.rag_documents;
CREATE POLICY "Admins can manage RAG documents" ON public.rag_documents
  FOR ALL
  USING ((select public.user_has_permission((select auth.uid()), 'rag_documents.manage'::text)))
  WITH CHECK ((select public.user_has_permission((select auth.uid()), 'rag_documents.manage'::text)));

DROP POLICY IF EXISTS "Anyone can read RAG documents" ON public.rag_documents;
CREATE POLICY "Anyone can read RAG documents" ON public.rag_documents
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Permitted staff can view role_permissions" ON public.role_permissions;
CREATE POLICY "Permitted staff can view role_permissions" ON public.role_permissions
  FOR SELECT
  USING ((select public.user_has_permission((select auth.uid()), 'roles.read'::text)));

DROP POLICY IF EXISTS "Role managers have full access to role_permissions" ON public.role_permissions;
CREATE POLICY "Role managers have full access to role_permissions" ON public.role_permissions
  FOR ALL
  USING ((select public.user_has_permission((select auth.uid()), 'roles.manage'::text)))
  WITH CHECK ((select public.user_has_permission((select auth.uid()), 'roles.manage'::text)));

DROP POLICY IF EXISTS "Permitted staff can view roles" ON public.roles;
CREATE POLICY "Permitted staff can view roles" ON public.roles
  FOR SELECT
  USING ((select public.user_has_permission((select auth.uid()), 'roles.read'::text)));

DROP POLICY IF EXISTS "Role managers have full access to roles" ON public.roles;
CREATE POLICY "Role managers have full access to roles" ON public.roles
  FOR ALL
  USING ((select public.user_has_permission((select auth.uid()), 'roles.manage'::text)))
  WITH CHECK ((select public.user_has_permission((select auth.uid()), 'roles.manage'::text)));

DROP POLICY IF EXISTS "Specialist creates own patients" ON public.specialist_patients;
CREATE POLICY "Specialist creates own patients" ON public.specialist_patients
  FOR INSERT
  TO authenticated
  WITH CHECK (((select public.user_has_permission((select auth.uid()), 'specialist.patients'::text)) AND (specialist_id = (select auth.uid())) AND (deleted_at IS NULL)));

DROP POLICY IF EXISTS "Specialist reads own active patients" ON public.specialist_patients;
CREATE POLICY "Specialist reads own active patients" ON public.specialist_patients
  FOR SELECT
  TO authenticated
  USING (((select public.user_has_permission((select auth.uid()), 'specialist.patients'::text)) AND (specialist_id = (select auth.uid())) AND (deleted_at IS NULL)));

DROP POLICY IF EXISTS "Specialist updates own patients" ON public.specialist_patients;
CREATE POLICY "Specialist updates own patients" ON public.specialist_patients
  FOR UPDATE
  TO authenticated
  USING (((select public.user_has_permission((select auth.uid()), 'specialist.patients'::text)) AND (specialist_id = (select auth.uid()))))
  WITH CHECK (((select public.user_has_permission((select auth.uid()), 'specialist.patients'::text)) AND (specialist_id = (select auth.uid()))));

DROP POLICY IF EXISTS "Specialist creates own records" ON public.specialist_records;
CREATE POLICY "Specialist creates own records" ON public.specialist_records
  FOR INSERT
  TO authenticated
  WITH CHECK (((select public.user_has_permission((select auth.uid()), 'specialist.records'::text)) AND (specialist_id = (select auth.uid())) AND (deleted_at IS NULL)));

DROP POLICY IF EXISTS "Specialist reads own active records" ON public.specialist_records;
CREATE POLICY "Specialist reads own active records" ON public.specialist_records
  FOR SELECT
  TO authenticated
  USING (((select public.user_has_permission((select auth.uid()), 'specialist.records'::text)) AND (specialist_id = (select auth.uid())) AND (deleted_at IS NULL)));

DROP POLICY IF EXISTS "Specialist updates own records" ON public.specialist_records;
CREATE POLICY "Specialist updates own records" ON public.specialist_records
  FOR UPDATE
  TO authenticated
  USING (((select public.user_has_permission((select auth.uid()), 'specialist.records'::text)) AND (specialist_id = (select auth.uid()))))
  WITH CHECK (((select public.user_has_permission((select auth.uid()), 'specialist.records'::text)) AND (specialist_id = (select auth.uid()))));

DROP POLICY IF EXISTS "Admins can view system logs" ON public.system_logs;
CREATE POLICY "Admins can view system logs" ON public.system_logs
  FOR SELECT
  USING ((select public.user_has_permission((select auth.uid()), 'system_logs.read'::text)));

DROP POLICY IF EXISTS "Allow patient delete own pending files" ON storage.objects;
CREATE POLICY "Allow patient delete own pending files" ON storage.objects
  FOR DELETE
  USING (((bucket_id = 'patient-documents'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text) AND ((storage.foldername(name))[2] = 'pending-submissions'::text) AND ((metadata ->> 'klinikaid_document_id'::text) IS NULL) AND (NOT (EXISTS ( SELECT 1 FROM documents d WHERE (d.file_path = objects.name))))));

DROP POLICY IF EXISTS "Allow patient read own files" ON storage.objects;
CREATE POLICY "Allow patient read own files" ON storage.objects
  FOR SELECT
  USING (((bucket_id = 'patient-documents'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text)));

DROP POLICY IF EXISTS "Allow patient upload own files" ON storage.objects;
CREATE POLICY "Allow patient upload own files" ON storage.objects
  FOR INSERT
  WITH CHECK (((bucket_id = 'patient-documents'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text) AND ((storage.foldername(name))[2] = 'pending-submissions'::text)));

DROP POLICY IF EXISTS "Allow staff and admin read all patient files" ON storage.objects;
CREATE POLICY "Allow staff and admin read all patient files" ON storage.objects
  FOR SELECT
  USING (((bucket_id = 'patient-documents'::text) AND (select public.user_has_permission((select auth.uid()), 'storage.patient_documents.read'::text))));
commit;
