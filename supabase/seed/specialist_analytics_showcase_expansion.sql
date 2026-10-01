-- KlinikAid specialist analytics showcase expansion
-- Operator runs this manually in Supabase SQL Editor.
-- Additive: creates extra Dr. Jojo demo patients with denser longitudinal graph data.
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
  existing_showcase_patients integer;
begin
  select count(*)
  into valid_specialist
  from public.profiles
  where id = 'd64f1748-1fc8-4df4-9072-e810fd667c8f'
    and role = 'medical_specialist'
    and is_active = true;

  if valid_specialist <> 1 then
    raise exception 'Showcase seed aborted: Dr. Jojo profile is not an active medical_specialist.';
  end if;

  select count(*)
  into existing_showcase_patients
  from public.specialist_patients
  where email like 'ka.seed.analytics.showcase.%@example.test';

  if existing_showcase_patients > 0 then
    raise exception 'Showcase seed aborted: found % existing showcase patients. Run cleanup first or inspect rows.', existing_showcase_patients;
  end if;
end $$;

with seed_patients(
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
) as (
  values
    ('d64f1748-1fc8-4df4-9072-e810fd667c8f'::uuid, 'Seed Graph Antonio', 'Marquez', '1974-02-11'::date, 'male', '09170100101', 'ka.seed.analytics.showcase.antonio.marquez@example.test', 'Quezon City', '2026-04-12 01:15:00+00'::timestamptz, '2026-07-15 02:15:00+00'::timestamptz),
    ('d64f1748-1fc8-4df4-9072-e810fd667c8f'::uuid, 'Seed Graph Corazon', 'Villareal', '1980-06-19'::date, 'female', '09170100102', 'ka.seed.analytics.showcase.corazon.villareal@example.test', 'Manila', '2026-04-15 02:15:00+00'::timestamptz, '2026-07-15 03:15:00+00'::timestamptz),
    ('d64f1748-1fc8-4df4-9072-e810fd667c8f'::uuid, 'Seed Graph Dennis', 'Manalo', '1966-09-04'::date, 'male', '09170100103', 'ka.seed.analytics.showcase.dennis.manalo@example.test', 'Pasig', '2026-05-02 03:15:00+00'::timestamptz, '2026-07-15 04:15:00+00'::timestamptz),
    ('d64f1748-1fc8-4df4-9072-e810fd667c8f'::uuid, 'Seed Graph Felisa', 'Abad', '1992-12-28'::date, 'female', '09170100104', 'ka.seed.analytics.showcase.felisa.abad@example.test', 'Makati', '2026-05-18 04:15:00+00'::timestamptz, '2026-07-15 05:15:00+00'::timestamptz),
    ('d64f1748-1fc8-4df4-9072-e810fd667c8f'::uuid, 'Seed Graph Gio', 'Salcedo', '1987-03-06'::date, 'other', '09170100105', 'ka.seed.analytics.showcase.gio.salcedo@example.test', 'Taguig', '2026-04-18 05:15:00+00'::timestamptz, '2026-07-15 06:15:00+00'::timestamptz),
    ('d64f1748-1fc8-4df4-9072-e810fd667c8f'::uuid, 'Seed Graph Helena', 'Pascual', '1959-11-22'::date, 'female', '09170100106', 'ka.seed.analytics.showcase.helena.pascual@example.test', 'Caloocan', '2026-06-02 01:45:00+00'::timestamptz, '2026-07-15 02:45:00+00'::timestamptz)
)
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
select
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
from seed_patients;

with ref_ranges(test_name, unit, male_min, male_max, female_min, female_max) as (
  values
    ('Hemoglobin', 'g/dL', 13.5::numeric, 17.5::numeric, 12.0::numeric, 15.5::numeric),
    ('White Blood Cells (WBC)', 'x10^3/uL', 4.5::numeric, 11.0::numeric, 4.5::numeric, 11.0::numeric),
    ('Platelets', 'x10^3/uL', 150::numeric, 450::numeric, 150::numeric, 450::numeric),
    ('Fasting Blood Sugar (FBS)', 'mg/dL', 70::numeric, 100::numeric, 70::numeric, 100::numeric),
    ('Creatinine', 'mg/dL', 0.6::numeric, 1.2::numeric, 0.5::numeric, 1.1::numeric),
    ('Cholesterol', 'mg/dL', 100::numeric, 200::numeric, 100::numeric, 200::numeric)
),
seed_results(email, test_type, test_name, test_value, created_at) as (
  values
    -- Antonio: dramatic cholesterol climb across 3 months + supporting records.
    ('ka.seed.analytics.showcase.antonio.marquez@example.test', 'Lipid Profile', 'Cholesterol', '168', '2026-04-15 01:30:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.antonio.marquez@example.test', 'Lipid Profile', 'Cholesterol', '182', '2026-04-29 01:35:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.antonio.marquez@example.test', 'Lipid Profile', 'Cholesterol', '196', '2026-05-13 01:40:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.antonio.marquez@example.test', 'Lipid Profile', 'Cholesterol', '211', '2026-05-27 01:45:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.antonio.marquez@example.test', 'Lipid Profile', 'Cholesterol', '226', '2026-06-10 01:50:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.antonio.marquez@example.test', 'Lipid Profile', 'Cholesterol', '239', '2026-06-24 01:55:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.antonio.marquez@example.test', 'Lipid Profile', 'Cholesterol', '252', '2026-07-08 02:00:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.antonio.marquez@example.test', 'Fasting Blood Sugar (FBS)', 'Fasting Blood Sugar (FBS)', '92', '2026-04-15 01:50:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.antonio.marquez@example.test', 'Renal Function', 'Creatinine', '1.0', '2026-05-27 02:00:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.antonio.marquez@example.test', 'Complete Blood Count (CBC)', 'Hemoglobin', '14.8', '2026-07-08 02:15:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.antonio.marquez@example.test', 'Complete Blood Count (CBC)', 'White Blood Cells (WBC)', '8.1', '2026-07-08 02:15:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.antonio.marquez@example.test', 'Complete Blood Count (CBC)', 'Platelets', '286', '2026-07-08 02:15:00+00'::timestamptz),

    -- Corazon: hemoglobin recovery across 3 months + stable platelets.
    ('ka.seed.analytics.showcase.corazon.villareal@example.test', 'Complete Blood Count (CBC)', 'Hemoglobin', '10.4', '2026-04-16 02:30:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.corazon.villareal@example.test', 'Complete Blood Count (CBC)', 'Hemoglobin', '10.9', '2026-04-30 02:35:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.corazon.villareal@example.test', 'Complete Blood Count (CBC)', 'Hemoglobin', '11.5', '2026-05-14 02:40:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.corazon.villareal@example.test', 'Complete Blood Count (CBC)', 'Hemoglobin', '12.1', '2026-05-28 02:45:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.corazon.villareal@example.test', 'Complete Blood Count (CBC)', 'Hemoglobin', '12.7', '2026-06-11 02:50:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.corazon.villareal@example.test', 'Complete Blood Count (CBC)', 'Hemoglobin', '13.2', '2026-06-25 02:55:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.corazon.villareal@example.test', 'Complete Blood Count (CBC)', 'Hemoglobin', '13.5', '2026-07-09 03:00:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.corazon.villareal@example.test', 'Complete Blood Count (CBC)', 'White Blood Cells (WBC)', '6.4', '2026-04-16 03:10:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.corazon.villareal@example.test', 'Complete Blood Count (CBC)', 'White Blood Cells (WBC)', '6.8', '2026-05-28 03:10:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.corazon.villareal@example.test', 'Complete Blood Count (CBC)', 'Platelets', '255', '2026-04-16 03:15:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.corazon.villareal@example.test', 'Complete Blood Count (CBC)', 'Platelets', '272', '2026-05-28 03:15:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.corazon.villareal@example.test', 'Fasting Blood Sugar (FBS)', 'Fasting Blood Sugar (FBS)', '84', '2026-07-09 03:20:00+00'::timestamptz),

    -- Dennis: FBS spike then partial improvement across 10 weeks.
    ('ka.seed.analytics.showcase.dennis.manalo@example.test', 'Fasting Blood Sugar (FBS)', 'Fasting Blood Sugar (FBS)', '94', '2026-05-05 03:30:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.dennis.manalo@example.test', 'Fasting Blood Sugar (FBS)', 'Fasting Blood Sugar (FBS)', '111', '2026-05-19 03:35:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.dennis.manalo@example.test', 'Fasting Blood Sugar (FBS)', 'Fasting Blood Sugar (FBS)', '132', '2026-06-02 03:40:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.dennis.manalo@example.test', 'Fasting Blood Sugar (FBS)', 'Fasting Blood Sugar (FBS)', '148', '2026-06-16 03:45:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.dennis.manalo@example.test', 'Fasting Blood Sugar (FBS)', 'Fasting Blood Sugar (FBS)', '124', '2026-06-30 03:50:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.dennis.manalo@example.test', 'Fasting Blood Sugar (FBS)', 'Fasting Blood Sugar (FBS)', '109', '2026-07-08 03:55:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.dennis.manalo@example.test', 'Fasting Blood Sugar (FBS)', 'Fasting Blood Sugar (FBS)', '99', '2026-07-15 04:00:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.dennis.manalo@example.test', 'Lipid Profile', 'Cholesterol', '188', '2026-05-05 04:15:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.dennis.manalo@example.test', 'Renal Function', 'Creatinine', '1.1', '2026-06-16 04:15:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.dennis.manalo@example.test', 'Complete Blood Count (CBC)', 'Hemoglobin', '15.2', '2026-07-15 04:20:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.dennis.manalo@example.test', 'Complete Blood Count (CBC)', 'White Blood Cells (WBC)', '7.4', '2026-07-15 04:20:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.dennis.manalo@example.test', 'Complete Blood Count (CBC)', 'Platelets', '310', '2026-07-15 04:20:00+00'::timestamptz),

    -- Felisa: stable normal cholesterol for contrast across one month.
    ('ka.seed.analytics.showcase.felisa.abad@example.test', 'Lipid Profile', 'Cholesterol', '168', '2026-06-03 04:30:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.felisa.abad@example.test', 'Lipid Profile', 'Cholesterol', '171', '2026-06-10 04:35:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.felisa.abad@example.test', 'Lipid Profile', 'Cholesterol', '169', '2026-06-17 04:40:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.felisa.abad@example.test', 'Lipid Profile', 'Cholesterol', '172', '2026-06-24 04:45:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.felisa.abad@example.test', 'Lipid Profile', 'Cholesterol', '170', '2026-07-01 04:50:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.felisa.abad@example.test', 'Lipid Profile', 'Cholesterol', '174', '2026-07-08 04:55:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.felisa.abad@example.test', 'Lipid Profile', 'Cholesterol', '171', '2026-07-15 05:00:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.felisa.abad@example.test', 'Fasting Blood Sugar (FBS)', 'Fasting Blood Sugar (FBS)', '78', '2026-06-03 05:10:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.felisa.abad@example.test', 'Renal Function', 'Creatinine', '0.8', '2026-06-24 05:15:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.felisa.abad@example.test', 'Complete Blood Count (CBC)', 'Hemoglobin', '13.1', '2026-07-15 05:20:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.felisa.abad@example.test', 'Complete Blood Count (CBC)', 'White Blood Cells (WBC)', '6.0', '2026-07-15 05:20:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.felisa.abad@example.test', 'Complete Blood Count (CBC)', 'Platelets', '288', '2026-07-15 05:20:00+00'::timestamptz),

    -- Gio: WBC extreme infection-like spike then normalizes.
    ('ka.seed.analytics.showcase.gio.salcedo@example.test', 'Complete Blood Count (CBC)', 'White Blood Cells (WBC)', '6.1', '2026-04-18 05:30:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.gio.salcedo@example.test', 'Complete Blood Count (CBC)', 'White Blood Cells (WBC)', '8.4', '2026-05-02 05:35:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.gio.salcedo@example.test', 'Complete Blood Count (CBC)', 'White Blood Cells (WBC)', '15.8', '2026-05-16 05:40:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.gio.salcedo@example.test', 'Complete Blood Count (CBC)', 'White Blood Cells (WBC)', '18.2', '2026-05-30 05:45:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.gio.salcedo@example.test', 'Complete Blood Count (CBC)', 'White Blood Cells (WBC)', '12.6', '2026-06-13 05:50:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.gio.salcedo@example.test', 'Complete Blood Count (CBC)', 'White Blood Cells (WBC)', '9.3', '2026-06-27 05:55:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.gio.salcedo@example.test', 'Complete Blood Count (CBC)', 'White Blood Cells (WBC)', '6.9', '2026-07-11 06:00:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.gio.salcedo@example.test', 'Complete Blood Count (CBC)', 'Hemoglobin', '14.6', '2026-04-18 06:10:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.gio.salcedo@example.test', 'Complete Blood Count (CBC)', 'Platelets', '340', '2026-04-18 06:10:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.gio.salcedo@example.test', 'Fasting Blood Sugar (FBS)', 'Fasting Blood Sugar (FBS)', '88', '2026-06-27 06:15:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.gio.salcedo@example.test', 'Renal Function', 'Creatinine', '1.0', '2026-07-11 06:20:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.gio.salcedo@example.test', 'Lipid Profile', 'Cholesterol', '190', '2026-07-11 06:25:00+00'::timestamptz),

    -- Helena: creatinine worsening across six weeks, female range.
    ('ka.seed.analytics.showcase.helena.pascual@example.test', 'Renal Function', 'Creatinine', '0.7', '2026-06-03 01:45:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.helena.pascual@example.test', 'Renal Function', 'Creatinine', '0.9', '2026-06-10 01:50:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.helena.pascual@example.test', 'Renal Function', 'Creatinine', '1.0', '2026-06-17 01:55:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.helena.pascual@example.test', 'Renal Function', 'Creatinine', '1.2', '2026-06-24 02:00:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.helena.pascual@example.test', 'Renal Function', 'Creatinine', '1.4', '2026-07-01 02:05:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.helena.pascual@example.test', 'Renal Function', 'Creatinine', '1.6', '2026-07-08 02:10:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.helena.pascual@example.test', 'Renal Function', 'Creatinine', '1.5', '2026-07-15 02:15:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.helena.pascual@example.test', 'Fasting Blood Sugar (FBS)', 'Fasting Blood Sugar (FBS)', '90', '2026-06-03 02:30:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.helena.pascual@example.test', 'Lipid Profile', 'Cholesterol', '202', '2026-06-24 02:35:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.helena.pascual@example.test', 'Complete Blood Count (CBC)', 'Hemoglobin', '11.8', '2026-07-15 02:40:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.helena.pascual@example.test', 'Complete Blood Count (CBC)', 'White Blood Cells (WBC)', '7.7', '2026-07-15 02:40:00+00'::timestamptz),
    ('ka.seed.analytics.showcase.helena.pascual@example.test', 'Complete Blood Count (CBC)', 'Platelets', '244', '2026-07-15 02:40:00+00'::timestamptz)
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
    '[KA_REDEFENSE_ANALYTICS_SEED_20260715] Showcase dense longitudinal graph data.'::text as notes,
    sr.created_at,
    sr.created_at as updated_at
  from seed_results sr
  join public.specialist_patients sp on sp.email = sr.email
  join ref_ranges rr on rr.test_name = sr.test_name
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

-- Validation: each showcase patient should have at least 10 total records.
select sp.email, count(sr.id) as total_records
from public.specialist_patients sp
join public.specialist_records sr on sr.specialist_patient_id = sp.id
where sp.email like 'ka.seed.analytics.showcase.%@example.test'
group by sp.email
order by sp.email;

-- Validation: each showcase trend metric should have at least 5 points.
select sp.email, sr.test_name, count(*) as points, min(sr.created_at) as first_date, max(sr.created_at) as latest_date
from public.specialist_patients sp
join public.specialist_records sr on sr.specialist_patient_id = sp.id
where sp.email like 'ka.seed.analytics.showcase.%@example.test'
group by sp.email, sr.test_name
having count(*) >= 5
order by sp.email, sr.test_name;

-- Validation: flagged rows added by the showcase expansion.
select is_flagged, count(*) as rows
from public.specialist_records
where notes like '%Showcase dense longitudinal graph data%'
group by is_flagged
order by is_flagged;

commit;
