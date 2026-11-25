-- KlinikAid Migration 49: the specialist roster's per-patient record stats in one query
-- Why (issue #263): /specialist/patients and GET /api/specialist/patients downloaded
-- every specialist_records row for the listed patients (the page up to 50,000,
-- the API uncapped and so subject to PostgREST's max-rows cap, which would make
-- the counts silently low), then re-filtered that array once per patient to get
-- three numbers: record count, flagged count and the latest record date.
-- Adds specialist_patient_record_stats(): those three numbers per patient,
-- grouped in the database. SECURITY INVOKER, so the existing
-- "Specialist reads own active records" policy still decides which rows count,
-- exactly as it did for the direct table read. At most one row per patient id.
-- Also indexes specialist_records(specialist_patient_id, created_at): the
-- foreign key had no index, so every roster load scanned the table.
-- ORDERING: apply BEFORE the code that calls it deploys; the roster errors
-- (PGRST202) without it. Additive and unused by the current code, so safe early.
-- ROLLBACK: drop function public.specialist_patient_record_stats(uuid[], text, timestamptz, timestamptz);
--           drop index public.idx_specialist_records_patient_created_at;

begin;

create index if not exists idx_specialist_records_patient_created_at
  on public.specialist_records using btree (specialist_patient_id, created_at);

create or replace function public.specialist_patient_record_stats(
  patient_ids uuid[],
  p_test_type text default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  specialist_patient_id uuid,
  total_records bigint,
  flagged_count bigint,
  last_test_date timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.specialist_patient_id,
         count(*),
         count(*) filter (where r.is_flagged),
         max(r.created_at)
    from public.specialist_records r
   where r.specialist_patient_id = any (patient_ids)
     and (p_test_type is null or r.test_type = p_test_type)
     and (p_from is null or r.created_at >= p_from)
     and (p_to is null or r.created_at <= p_to)
   group by r.specialist_patient_id;
$$;

revoke all on function public.specialist_patient_record_stats(uuid[], text, timestamptz, timestamptz) from public, anon;
grant execute on function public.specialist_patient_record_stats(uuid[], text, timestamptz, timestamptz) to authenticated;

commit;
