-- KlinikAid Migration 22: soft-delete specialist patients instead of destroying them
--
-- CONTEXT
-- deleteSpecialistPatientAction issued a hard DELETE on public.specialist_patients.
-- specialist_records.specialist_patient_id is ON DELETE CASCADE, so deleting one
-- patient row irrecoverably destroyed that patient's entire longitudinal
-- diagnostic history -- and, unlike the create path beside it in the same file,
-- the delete wrote no audit event at all. There was no trace and no way back.
--
-- FIX
-- Archival instead of destruction. A deleted patient keeps every record and
-- simply stops appearing in the specialist's views. An audit event is written
-- by the caller (migration alone cannot log an action it never sees).
--
-- Policies are split per command because a single FOR ALL policy cannot express
-- "hidden from reads, but you may archive it":
--   SELECT  -- active rows only, so archived patients leave every list and count
--   INSERT  -- owner only
--   UPDATE  -- owner only, and deliberately NOT constrained on deleted_at, so the
--              archiving UPDATE is permitted (a FOR ALL policy with deleted_at IS
--              NULL in WITH CHECK would reject its own archive)
--   DELETE  -- not granted. Specialists can no longer destroy records at all;
--              only the service-role path can, which is the intent.
--
-- KNOWN LIMITATION: an archived patient cannot be restored through the app. RLS
-- hides it from the owner's SELECT policy, so an UPDATE cannot see the row. That
-- is a deliberate trade for this migration; a restore path needs a separate
-- policy and is out of scope here.

-- CORRECTION. The first version of this migration wrote the policies against
-- `specialist_id = auth.uid()` only. Verified against the live database, that
-- rejects an insert the application considers permitted:
--     "new row violates row-level security policy for table specialist_patients"
-- for an account that holds specialist.patients and returns true from
-- user_has_permission(). The old "Specialist manages own patients" policy was
-- being rewritten in the same run and its exact predicate could not be confirmed
-- beforehand. The policies below mirror the permission check the app already
-- enforces via requirePermission, so RLS and application layer agree.

begin;

alter table public.specialist_patients add column if not exists deleted_at timestamptz;
alter table public.specialist_records   add column if not exists deleted_at timestamptz;

drop policy if exists "Specialist manages own patients" on public.specialist_patients;
drop policy if exists "Specialist creates own patients" on public.specialist_patients;
drop policy if exists "Specialist reads own active patients" on public.specialist_patients;
drop policy if exists "Specialist updates own patients" on public.specialist_patients;

create policy "Specialist reads own active patients"
  on public.specialist_patients for select
  to authenticated
  using (public.user_has_permission(auth.uid(), 'specialist.patients') and specialist_id = auth.uid() and deleted_at is null);

create policy "Specialist creates own patients"
  on public.specialist_patients for insert
  to authenticated
  with check (public.user_has_permission(auth.uid(), 'specialist.patients') and specialist_id = auth.uid() and deleted_at is null);

create policy "Specialist updates own patients"
  on public.specialist_patients for update
  to authenticated
  using (public.user_has_permission(auth.uid(), 'specialist.patients') and specialist_id = auth.uid())
  with check (public.user_has_permission(auth.uid(), 'specialist.patients') and specialist_id = auth.uid());

drop policy if exists "Specialist manages own records" on public.specialist_records;
drop policy if exists "Specialist creates own records" on public.specialist_records;
drop policy if exists "Specialist reads own active records" on public.specialist_records;
drop policy if exists "Specialist updates own records" on public.specialist_records;

create policy "Specialist reads own active records"
  on public.specialist_records for select
  to authenticated
  using (public.user_has_permission(auth.uid(), 'specialist.records') and specialist_id = auth.uid() and deleted_at is null);

create policy "Specialist creates own records"
  on public.specialist_records for insert
  to authenticated
  with check (public.user_has_permission(auth.uid(), 'specialist.records') and specialist_id = auth.uid() and deleted_at is null);

create policy "Specialist updates own records"
  on public.specialist_records for update
  to authenticated
  using (public.user_has_permission(auth.uid(), 'specialist.records') and specialist_id = auth.uid())
  with check (public.user_has_permission(auth.uid(), 'specialist.records') and specialist_id = auth.uid());

-- No FOR DELETE policy is created for either table, so a specialist DELETE is
-- rejected by RLS. Records can only be removed through the service role.

commit;

-- ---------------------------------------------------------------------------
-- VERIFICATION (expect 6 policies, 3 per table, no FOR DELETE):
--   select tablename, policyname, cmd from pg_policies
--    where tablename in ('specialist_patients','specialist_records')
--    order by tablename, cmd;
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- ADDENDUM. Run this separately, after the block above.
--
-- The policies above cannot express "hide archived rows" without also blocking
-- the act of archiving. PostgreSQL re-applies a SELECT policy's USING to the
-- NEW row of an UPDATE whenever the statement needs SELECT privilege on the
-- target relation, so setting deleted_at immediately violates the very
-- `deleted_at IS NULL` clause that hides archived rows. Verified against the
-- live database: updating deleted_at to NULL succeeds, updating it to a
-- timestamp fails with "new row violates row-level security policy" -- and it
-- fails identically whether or not the statement uses RETURNING, so the
-- WITH CHECK of the UPDATE policy is not what rejects the row.
--
-- The archive therefore runs as SECURITY DEFINER, which bypasses RLS for its
-- own statements. Every safety property the policies provided is re-established
-- inside the function body: the caller must hold specialist.patients, and the
-- row must belong to the caller. set search_path = '' plus fully-qualified
-- names stops the RLS bypass from becoming a privilege-escalation hole, and the
-- REVOKE stops EXECUTE being available to anon.
--
-- Records are archived alongside the patient. specialist_records has its own
-- deleted_at column and its own SELECT policy, so archiving the patient alone
-- would leave their full diagnostic history still listed in dashboard and
-- analytics reads.

create or replace function public.archive_specialist_patient(p_patient_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- Ownership and permission are both re-checked here because SECURITY DEFINER
  -- bypasses the RLS policies that would otherwise enforce them.
  if not public.user_has_permission(auth.uid(), 'specialist.patients') then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  update public.specialist_patients p
     set deleted_at = timezone('utc', now()),
         updated_at  = timezone('utc', now())
   where p.id = p_patient_id
     and p.specialist_id = auth.uid()
     and p.deleted_at is null
  returning p.id into v_id;

  if v_id is null then
    return false;
  end if;

  update public.specialist_records r
     set deleted_at = timezone('utc', now()),
         updated_at  = timezone('utc', now())
   where r.specialist_patient_id = v_id
     and r.specialist_id = auth.uid()
     and r.deleted_at is null;

  return true;
end $$;

revoke all on function public.archive_specialist_patient(uuid) from public, anon;
grant execute on function public.archive_specialist_patient(uuid) to authenticated;