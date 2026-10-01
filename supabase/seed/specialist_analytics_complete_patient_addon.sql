-- KlinikAid specialist analytics complete-patient add-on
-- Operator runs this manually in Supabase SQL Editor.
-- Additive: creates one Dr. Jojo demo patient with 10 points for every analytics parameter.
-- Scope: public.specialist_patients + public.specialist_records only.
-- Cleanup is covered by specialist_analytics_seed_cleanup.sql because names/emails use the same seed pattern.

begin;

-- Preflight: Dr. Jojo must exist and be an active medical specialist.
select id, full_name, role, department, is_active
from public.profiles
where id = 'd64f1748-1fc8-4df4-9072-e810fd667c8f';

do $$
declare
  valid_specialist integer;
  existing_complete_patient integer;
begin
  select count(*)
  into valid_specialist
  from public.profiles
  where id = 'd64f1748-1fc8-4df4-9072-e810fd667c8f'
    and role = 'medical_specialist'
    and is_active = true;

  if valid_specialist <> 1 then
    raise exception 'Complete-patient seed aborted: Dr. Jojo profile is not an active medical_specialist.';
  end if;

  select count(*)
  into existing_complete_patient
  from public.specialist_patients
  where email = 'ka.seed.analytics.complete.rafael.navarro@example.test';

  if existing_complete_patient > 0 then
    raise exception 'Complete-patient seed aborted: complete showcase patient already exists. Run cleanup first or inspect rows.';
  end if;
end $$;

insert into public.specialist_patients (
  specialist_id,
  first_name,
  last_name,
  date_of_birth,
  gender,
  contact_number,
  email,
  address,
  created_at,
  updated_at
)
values (
  'd64f1748-1fc8-4df4-9072-e810fd667c8f'::uuid,
  'Seed Complete Rafael',
  'Navarro',
  '1979-08-17'::date,
  'male',
  '09170100999',
  'ka.seed.analytics.complete.rafael.navarro@example.test',
  'Quezon City',
  '2026-04-15 01:00:00+00'::timestamptz,
  '2026-07-15 02:30:00+00'::timestamptz
);

with ref_ranges(test_name, unit, male_min, male_max, female_min, female_max) as (
  values
    ('Hemoglobin', 'g/dL', 13.5::numeric, 17.5::numeric, 12.0::numeric, 15.5::numeric),
    ('White Blood Cells (WBC)', 'x10^3/uL', 4.5::numeric, 11.0::numeric, 4.5::numeric, 11.0::numeric),
    ('Platelets', 'x10^3/uL', 150::numeric, 450::numeric, 150::numeric, 450::numeric),
    ('Fasting Blood Sugar (FBS)', 'mg/dL', 70::numeric, 100::numeric, 70::numeric, 100::numeric),
    ('Creatinine', 'mg/dL', 0.6::numeric, 1.2::numeric, 0.5::numeric, 1.1::numeric),
    ('Cholesterol', 'mg/dL', 100::numeric, 200::numeric, 100::numeric, 200::numeric)
),
seed_results(test_type, test_name, test_value, created_at) as (
  values
    -- Hemoglobin: mostly stable, one high point, then returns normal.
    ('Complete Blood Count (CBC)', 'Hemoglobin', '14.2', '2026-04-16 01:30:00+00'::timestamptz),
    ('Complete Blood Count (CBC)', 'Hemoglobin', '14.5', '2026-04-26 01:30:00+00'::timestamptz),
    ('Complete Blood Count (CBC)', 'Hemoglobin', '13.9', '2026-05-06 01:30:00+00'::timestamptz),
    ('Complete Blood Count (CBC)', 'Hemoglobin', '14.8', '2026-05-16 01:30:00+00'::timestamptz),
    ('Complete Blood Count (CBC)', 'Hemoglobin', '15.0', '2026-05-26 01:30:00+00'::timestamptz),
    ('Complete Blood Count (CBC)', 'Hemoglobin', '17.8', '2026-06-05 01:30:00+00'::timestamptz),
    ('Complete Blood Count (CBC)', 'Hemoglobin', '16.4', '2026-06-15 01:30:00+00'::timestamptz),
    ('Complete Blood Count (CBC)', 'Hemoglobin', '15.6', '2026-06-25 01:30:00+00'::timestamptz),
    ('Complete Blood Count (CBC)', 'Hemoglobin', '14.9', '2026-07-05 01:30:00+00'::timestamptz),
    ('Complete Blood Count (CBC)', 'Hemoglobin', '14.3', '2026-07-15 01:30:00+00'::timestamptz),

    -- WBC: infection-like spike, then recovery.
    ('Complete Blood Count (CBC)', 'White Blood Cells (WBC)', '6.2', '2026-04-16 01:35:00+00'::timestamptz),
    ('Complete Blood Count (CBC)', 'White Blood Cells (WBC)', '7.1', '2026-04-26 01:35:00+00'::timestamptz),
    ('Complete Blood Count (CBC)', 'White Blood Cells (WBC)', '11.8', '2026-05-06 01:35:00+00'::timestamptz),
    ('Complete Blood Count (CBC)', 'White Blood Cells (WBC)', '14.5', '2026-05-16 01:35:00+00'::timestamptz),
    ('Complete Blood Count (CBC)', 'White Blood Cells (WBC)', '10.2', '2026-05-26 01:35:00+00'::timestamptz),
    ('Complete Blood Count (CBC)', 'White Blood Cells (WBC)', '8.9', '2026-06-05 01:35:00+00'::timestamptz),
    ('Complete Blood Count (CBC)', 'White Blood Cells (WBC)', '7.6', '2026-06-15 01:35:00+00'::timestamptz),
    ('Complete Blood Count (CBC)', 'White Blood Cells (WBC)', '6.8', '2026-06-25 01:35:00+00'::timestamptz),
    ('Complete Blood Count (CBC)', 'White Blood Cells (WBC)', '5.9', '2026-07-05 01:35:00+00'::timestamptz),
    ('Complete Blood Count (CBC)', 'White Blood Cells (WBC)', '6.3', '2026-07-15 01:35:00+00'::timestamptz),

    -- Platelets: mild high spike, then stable normal.
    ('Complete Blood Count (CBC)', 'Platelets', '250', '2026-04-16 01:40:00+00'::timestamptz),
    ('Complete Blood Count (CBC)', 'Platelets', '270', '2026-04-26 01:40:00+00'::timestamptz),
    ('Complete Blood Count (CBC)', 'Platelets', '465', '2026-05-06 01:40:00+00'::timestamptz),
    ('Complete Blood Count (CBC)', 'Platelets', '430', '2026-05-16 01:40:00+00'::timestamptz),
    ('Complete Blood Count (CBC)', 'Platelets', '390', '2026-05-26 01:40:00+00'::timestamptz),
    ('Complete Blood Count (CBC)', 'Platelets', '340', '2026-06-05 01:40:00+00'::timestamptz),
    ('Complete Blood Count (CBC)', 'Platelets', '305', '2026-06-15 01:40:00+00'::timestamptz),
    ('Complete Blood Count (CBC)', 'Platelets', '280', '2026-06-25 01:40:00+00'::timestamptz),
    ('Complete Blood Count (CBC)', 'Platelets', '260', '2026-07-05 01:40:00+00'::timestamptz),
    ('Complete Blood Count (CBC)', 'Platelets', '245', '2026-07-15 01:40:00+00'::timestamptz),

    -- FBS: worsens, then improves toward normal.
    ('Fasting Blood Sugar (FBS)', 'Fasting Blood Sugar (FBS)', '89', '2026-04-16 02:00:00+00'::timestamptz),
    ('Fasting Blood Sugar (FBS)', 'Fasting Blood Sugar (FBS)', '95', '2026-04-26 02:00:00+00'::timestamptz),
    ('Fasting Blood Sugar (FBS)', 'Fasting Blood Sugar (FBS)', '105', '2026-05-06 02:00:00+00'::timestamptz),
    ('Fasting Blood Sugar (FBS)', 'Fasting Blood Sugar (FBS)', '126', '2026-05-16 02:00:00+00'::timestamptz),
    ('Fasting Blood Sugar (FBS)', 'Fasting Blood Sugar (FBS)', '118', '2026-05-26 02:00:00+00'::timestamptz),
    ('Fasting Blood Sugar (FBS)', 'Fasting Blood Sugar (FBS)', '102', '2026-06-05 02:00:00+00'::timestamptz),
    ('Fasting Blood Sugar (FBS)', 'Fasting Blood Sugar (FBS)', '96', '2026-06-15 02:00:00+00'::timestamptz),
    ('Fasting Blood Sugar (FBS)', 'Fasting Blood Sugar (FBS)', '91', '2026-06-25 02:00:00+00'::timestamptz),
    ('Fasting Blood Sugar (FBS)', 'Fasting Blood Sugar (FBS)', '87', '2026-07-05 02:00:00+00'::timestamptz),
    ('Fasting Blood Sugar (FBS)', 'Fasting Blood Sugar (FBS)', '92', '2026-07-15 02:00:00+00'::timestamptz),

    -- Creatinine: renal concern peak, then improves.
    ('Renal Function', 'Creatinine', '0.9', '2026-04-16 02:20:00+00'::timestamptz),
    ('Renal Function', 'Creatinine', '1.0', '2026-04-26 02:20:00+00'::timestamptz),
    ('Renal Function', 'Creatinine', '1.1', '2026-05-06 02:20:00+00'::timestamptz),
    ('Renal Function', 'Creatinine', '1.3', '2026-05-16 02:20:00+00'::timestamptz),
    ('Renal Function', 'Creatinine', '1.5', '2026-05-26 02:20:00+00'::timestamptz),
    ('Renal Function', 'Creatinine', '1.4', '2026-06-05 02:20:00+00'::timestamptz),
    ('Renal Function', 'Creatinine', '1.2', '2026-06-15 02:20:00+00'::timestamptz),
    ('Renal Function', 'Creatinine', '1.1', '2026-06-25 02:20:00+00'::timestamptz),
    ('Renal Function', 'Creatinine', '1.0', '2026-07-05 02:20:00+00'::timestamptz),
    ('Renal Function', 'Creatinine', '0.9', '2026-07-15 02:20:00+00'::timestamptz),

    -- Cholesterol: steady upward trend ending abnormal.
    ('Lipid Profile', 'Cholesterol', '175', '2026-04-16 02:40:00+00'::timestamptz),
    ('Lipid Profile', 'Cholesterol', '190', '2026-04-26 02:40:00+00'::timestamptz),
    ('Lipid Profile', 'Cholesterol', '198', '2026-05-06 02:40:00+00'::timestamptz),
    ('Lipid Profile', 'Cholesterol', '205', '2026-05-16 02:40:00+00'::timestamptz),
    ('Lipid Profile', 'Cholesterol', '216', '2026-05-26 02:40:00+00'::timestamptz),
    ('Lipid Profile', 'Cholesterol', '228', '2026-06-05 02:40:00+00'::timestamptz),
    ('Lipid Profile', 'Cholesterol', '236', '2026-06-15 02:40:00+00'::timestamptz),
    ('Lipid Profile', 'Cholesterol', '242', '2026-06-25 02:40:00+00'::timestamptz),
    ('Lipid Profile', 'Cholesterol', '249', '2026-07-05 02:40:00+00'::timestamptz),
    ('Lipid Profile', 'Cholesterol', '255', '2026-07-15 02:40:00+00'::timestamptz)
),
records_to_insert as (
  select
    sp.id as specialist_patient_id,
    sp.specialist_id,
    sr.test_type,
    sr.test_name,
    sr.test_value,
    rr.unit,
    case when sp.gender = 'female' then rr.female_min else rr.male_min end as reference_range_min,
    case when sp.gender = 'female' then rr.female_max else rr.male_max end as reference_range_max,
    (
      sr.test_value::numeric < case when sp.gender = 'female' then rr.female_min else rr.male_min end
      or
      sr.test_value::numeric > case when sp.gender = 'female' then rr.female_max else rr.male_max end
    ) as is_flagged,
    '[KA_REDEFENSE_ANALYTICS_SEED_20260715] Complete patient all-parameter 10-point graph data.'::text as notes,
    sr.created_at,
    sr.created_at as updated_at
  from seed_results sr
  cross join public.specialist_patients sp
  join ref_ranges rr on rr.test_name = sr.test_name
  where sp.email = 'ka.seed.analytics.complete.rafael.navarro@example.test'
)
insert into public.specialist_records (
  specialist_patient_id,
  specialist_id,
  test_type,
  test_name,
  test_value,
  unit,
  reference_range_min,
  reference_range_max,
  is_flagged,
  notes,
  created_at,
  updated_at
)
select
  specialist_patient_id,
  specialist_id,
  test_type,
  test_name,
  test_value,
  unit,
  reference_range_min,
  reference_range_max,
  is_flagged,
  notes,
  created_at,
  updated_at
from records_to_insert;

-- Validation: this patient should show 10 points for every analytics parameter.
select
  sp.email,
  sr.test_name,
  count(*) as points,
  min(sr.created_at) as first_date,
  max(sr.created_at) as latest_date,
  count(*) filter (where sr.is_flagged) as flagged_points
from public.specialist_patients sp
join public.specialist_records sr on sr.specialist_patient_id = sp.id
where sp.email = 'ka.seed.analytics.complete.rafael.navarro@example.test'
group by sp.email, sr.test_name
order by sr.test_name;

commit;
