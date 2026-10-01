-- KlinikAid specialist analytics demo seed cleanup
-- Operator runs this manually in Supabase SQL Editor after demo/defense.
-- Deletes only rows tagged by the seed marker or seed patient email/name pattern.

begin;

-- Preview seed patients.
select id, specialist_id, first_name, last_name, email, created_at
from public.specialist_patients
where email like 'ka.seed.analytics.%@example.test'
   or first_name like 'Seed %'
order by specialist_id, last_name, first_name;

-- Preview seed records.
select
  id,
  specialist_patient_id,
  specialist_id,
  test_type,
  test_name,
  test_value,
  is_flagged,
  notes,
  created_at
from public.specialist_records
where notes like '%[KA_REDEFENSE_ANALYTICS_SEED_20260715]%'
order by created_at, specialist_patient_id, test_name;

-- Delete records first for audit clarity. Patient delete also cascades, but explicit record cleanup is safer to inspect.
delete from public.specialist_records
where notes like '%[KA_REDEFENSE_ANALYTICS_SEED_20260715]%';

delete from public.specialist_patients
where email like 'ka.seed.analytics.%@example.test'
   or first_name like 'Seed %';

-- Confirm cleanup.
select count(*) as remaining_seed_patients
from public.specialist_patients
where email like 'ka.seed.analytics.%@example.test'
   or first_name like 'Seed %';

select count(*) as remaining_seed_records
from public.specialist_records
where notes like '%[KA_REDEFENSE_ANALYTICS_SEED_20260715]%';

commit;
