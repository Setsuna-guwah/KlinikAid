-- KlinikAid specialist analytics demo seed
-- Operator runs this manually in Supabase SQL Editor.
-- Scope: public.specialist_patients + public.specialist_records only.
-- No result_date column exists in specialist_records; analytics maps result_date from created_at.

begin;

-- Preflight: both supplied accounts must exist and be medical specialists.
select id, full_name, role, department, is_active
from public.profiles
where id in (
  'd64f1748-1fc8-4df4-9072-e810fd667c8f',
  '47d88a06-8d2b-41c5-98d4-69a696eca0cc'
)
order by full_name;

do $$
declare
  valid_specialists integer;
  existing_seed_patients integer;
begin
  select count(*)
  into valid_specialists
  from public.profiles
  where id in (
    'd64f1748-1fc8-4df4-9072-e810fd667c8f',
    '47d88a06-8d2b-41c5-98d4-69a696eca0cc'
  )
  and role = 'medical_specialist';

  if valid_specialists <> 2 then
    raise exception 'Seed aborted: expected 2 medical_specialist profiles, found %.', valid_specialists;
  end if;

  select count(*)
  into existing_seed_patients
  from public.specialist_patients
  where email like 'ka.seed.analytics.%@example.test'
     or first_name like 'Seed %';

  if existing_seed_patients > 0 then
    raise exception 'Seed aborted: found % existing seed patients. Run cleanup first or inspect rows.', existing_seed_patients;
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
    ('d64f1748-1fc8-4df4-9072-e810fd667c8f'::uuid, 'Seed Maria', 'Santos', '1982-05-14'::date, 'female', '09170000001', 'ka.seed.analytics.maria.santos@example.test', 'Quezon City', '2026-04-20 02:00:00+00'::timestamptz, '2026-07-14 02:00:00+00'::timestamptz),
    ('d64f1748-1fc8-4df4-9072-e810fd667c8f'::uuid, 'Seed Carlos', 'Reyes', '1976-11-03'::date, 'male', '09170000002', 'ka.seed.analytics.carlos.reyes@example.test', 'Manila', '2026-04-22 03:00:00+00'::timestamptz, '2026-07-08 03:00:00+00'::timestamptz),
    ('d64f1748-1fc8-4df4-9072-e810fd667c8f'::uuid, 'Seed Liza', 'Dela Cruz', '1991-02-22'::date, 'female', '09170000003', 'ka.seed.analytics.liza.delacruz@example.test', 'Caloocan', '2026-04-24 01:30:00+00'::timestamptz, '2026-07-14 04:00:00+00'::timestamptz),
    ('d64f1748-1fc8-4df4-9072-e810fd667c8f'::uuid, 'Seed Ramon', 'Garcia', '1968-07-19'::date, 'male', '09170000004', 'ka.seed.analytics.ramon.garcia@example.test', 'Pasig', '2026-04-26 05:00:00+00'::timestamptz, '2026-07-10 05:10:00+00'::timestamptz),
    ('d64f1748-1fc8-4df4-9072-e810fd667c8f'::uuid, 'Seed Andrea', 'Lim', '1988-09-30'::date, 'female', '09170000005', 'ka.seed.analytics.andrea.lim@example.test', 'Makati', '2026-05-01 02:20:00+00'::timestamptz, '2026-07-11 06:00:00+00'::timestamptz),
    ('d64f1748-1fc8-4df4-9072-e810fd667c8f'::uuid, 'Seed Noel', 'Bautista', '2001-01-18'::date, 'male', '09170000006', 'ka.seed.analytics.noel.bautista@example.test', 'Marikina', '2026-05-03 03:20:00+00'::timestamptz, '2026-07-12 03:20:00+00'::timestamptz),
    ('d64f1748-1fc8-4df4-9072-e810fd667c8f'::uuid, 'Seed Patricia', 'Mendoza', '1995-06-07'::date, 'female', '09170000007', 'ka.seed.analytics.patricia.mendoza@example.test', 'Taguig', '2026-05-05 04:30:00+00'::timestamptz, '2026-07-13 04:30:00+00'::timestamptz),
    ('d64f1748-1fc8-4df4-9072-e810fd667c8f'::uuid, 'Seed Tomas', 'Aquino', '1959-12-02'::date, 'male', '09170000008', 'ka.seed.analytics.tomas.aquino@example.test', 'San Juan', '2026-05-07 05:00:00+00'::timestamptz, '2026-07-14 05:00:00+00'::timestamptz),
    ('d64f1748-1fc8-4df4-9072-e810fd667c8f'::uuid, 'Seed Mika', 'Flores', '1999-03-11'::date, 'other', '09170000009', 'ka.seed.analytics.mika.flores@example.test', 'Paranaque', '2026-05-10 01:45:00+00'::timestamptz, '2026-07-04 01:45:00+00'::timestamptz),
    ('d64f1748-1fc8-4df4-9072-e810fd667c8f'::uuid, 'Seed Elena', 'Navarro', '1985-08-25'::date, 'female', '09170000010', 'ka.seed.analytics.elena.navarro@example.test', 'Las Pinas', '2026-05-12 02:45:00+00'::timestamptz, '2026-07-06 02:45:00+00'::timestamptz),
    ('d64f1748-1fc8-4df4-9072-e810fd667c8f'::uuid, 'Seed Paolo', 'Villanueva', '1972-04-09'::date, 'male', '09170000011', 'ka.seed.analytics.paolo.villanueva@example.test', 'Mandaluyong', '2026-05-14 03:10:00+00'::timestamptz, '2026-07-02 03:10:00+00'::timestamptz),
    ('d64f1748-1fc8-4df4-9072-e810fd667c8f'::uuid, 'Seed Jessa', 'Cruz', '2007-10-16'::date, 'female', '09170000012', 'ka.seed.analytics.jessa.cruz@example.test', 'Valenzuela', '2026-05-16 04:10:00+00'::timestamptz, '2026-07-05 04:10:00+00'::timestamptz),

    ('47d88a06-8d2b-41c5-98d4-69a696eca0cc'::uuid, 'Seed Ana', 'Mercado', '1984-01-29'::date, 'female', '09170000013', 'ka.seed.analytics.ana.mercado@example.test', 'Quezon City', '2026-04-21 02:15:00+00'::timestamptz, '2026-07-09 02:15:00+00'::timestamptz),
    ('47d88a06-8d2b-41c5-98d4-69a696eca0cc'::uuid, 'Seed Miguel', 'Tan', '1979-05-05'::date, 'male', '09170000014', 'ka.seed.analytics.miguel.tan@example.test', 'Manila', '2026-04-23 03:15:00+00'::timestamptz, '2026-07-10 03:15:00+00'::timestamptz),
    ('47d88a06-8d2b-41c5-98d4-69a696eca0cc'::uuid, 'Seed Grace', 'Ramos', '1990-12-12'::date, 'female', '09170000015', 'ka.seed.analytics.grace.ramos@example.test', 'Pasay', '2026-04-25 04:15:00+00'::timestamptz, '2026-07-11 04:15:00+00'::timestamptz),
    ('47d88a06-8d2b-41c5-98d4-69a696eca0cc'::uuid, 'Seed Roberto', 'Sy', '1964-09-06'::date, 'male', '09170000016', 'ka.seed.analytics.roberto.sy@example.test', 'Pasig', '2026-04-27 05:15:00+00'::timestamptz, '2026-07-14 05:15:00+00'::timestamptz),
    ('47d88a06-8d2b-41c5-98d4-69a696eca0cc'::uuid, 'Seed Kara', 'Lopez', '1997-07-21'::date, 'other', '09170000017', 'ka.seed.analytics.kara.lopez@example.test', 'Taguig', '2026-05-02 01:50:00+00'::timestamptz, '2026-07-07 01:50:00+00'::timestamptz),
    ('47d88a06-8d2b-41c5-98d4-69a696eca0cc'::uuid, 'Seed Daniel', 'Castillo', '1970-02-03'::date, 'male', '09170000018', 'ka.seed.analytics.daniel.castillo@example.test', 'Makati', '2026-05-04 02:50:00+00'::timestamptz, '2026-07-01 02:50:00+00'::timestamptz),
    ('47d88a06-8d2b-41c5-98d4-69a696eca0cc'::uuid, 'Seed Irene', 'Chua', '1987-11-17'::date, 'female', '09170000019', 'ka.seed.analytics.irene.chua@example.test', 'Caloocan', '2026-05-06 03:50:00+00'::timestamptz, '2026-07-03 03:50:00+00'::timestamptz),
    ('47d88a06-8d2b-41c5-98d4-69a696eca0cc'::uuid, 'Seed Victor', 'Ong', '1962-06-28'::date, 'male', '09170000020', 'ka.seed.analytics.victor.ong@example.test', 'Mandaluyong', '2026-05-08 04:50:00+00'::timestamptz, '2026-07-06 04:50:00+00'::timestamptz),
    ('47d88a06-8d2b-41c5-98d4-69a696eca0cc'::uuid, 'Seed Lea', 'Gonzales', '1994-04-14'::date, 'female', '09170000021', 'ka.seed.analytics.lea.gonzales@example.test', 'Marikina', '2026-05-11 01:25:00+00'::timestamptz, '2026-07-05 01:25:00+00'::timestamptz),
    ('47d88a06-8d2b-41c5-98d4-69a696eca0cc'::uuid, 'Seed Omar', 'Santos', '1981-08-08'::date, 'other', '09170000022', 'ka.seed.analytics.omar.santos@example.test', 'San Juan', '2026-05-13 02:25:00+00'::timestamptz, '2026-07-04 02:25:00+00'::timestamptz),
    ('47d88a06-8d2b-41c5-98d4-69a696eca0cc'::uuid, 'Seed Nina', 'Torres', '2002-03-24'::date, 'female', '09170000023', 'ka.seed.analytics.nina.torres@example.test', 'Valenzuela', '2026-05-15 03:25:00+00'::timestamptz, '2026-07-02 03:25:00+00'::timestamptz),
    ('47d88a06-8d2b-41c5-98d4-69a696eca0cc'::uuid, 'Seed Benjie', 'Rivera', '1958-10-01'::date, 'male', '09170000024', 'ka.seed.analytics.benjie.rivera@example.test', 'Las Pinas', '2026-05-17 04:25:00+00'::timestamptz, '2026-07-07 04:25:00+00'::timestamptz)
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
    ('White Blood Cells (WBC)', 'x10^3/µL', 4.5::numeric, 11.0::numeric, 4.5::numeric, 11.0::numeric),
    ('Platelets', 'x10^3/µL', 150::numeric, 450::numeric, 150::numeric, 450::numeric),
    ('Fasting Blood Sugar (FBS)', 'mg/dL', 70::numeric, 100::numeric, 70::numeric, 100::numeric),
    ('Creatinine', 'mg/dL', 0.6::numeric, 1.2::numeric, 0.5::numeric, 1.1::numeric),
    ('Cholesterol', 'mg/dL', 100::numeric, 200::numeric, 100::numeric, 200::numeric)
),
seed_results(email, test_type, test_name, test_value, created_at) as (
  values
    -- Dr. Jojo: longitudinal cholesterol trend, upward and flagged near the end.
    ('ka.seed.analytics.carlos.reyes@example.test', 'Lipid Profile', 'Cholesterol', '178', '2026-04-22 02:00:00+00'::timestamptz),
    ('ka.seed.analytics.carlos.reyes@example.test', 'Lipid Profile', 'Cholesterol', '192', '2026-05-20 02:20:00+00'::timestamptz),
    ('ka.seed.analytics.carlos.reyes@example.test', 'Lipid Profile', 'Cholesterol', '205', '2026-06-17 02:40:00+00'::timestamptz),
    ('ka.seed.analytics.carlos.reyes@example.test', 'Lipid Profile', 'Cholesterol', '222', '2026-07-01 03:00:00+00'::timestamptz),
    ('ka.seed.analytics.carlos.reyes@example.test', 'Lipid Profile', 'Cholesterol', '238', '2026-07-08 03:20:00+00'::timestamptz),

    -- Dr. Jojo: female hemoglobin recovery trend.
    ('ka.seed.analytics.maria.santos@example.test', 'Complete Blood Count (CBC)', 'Hemoglobin', '10.9', '2026-04-21 01:20:00+00'::timestamptz),
    ('ka.seed.analytics.maria.santos@example.test', 'Complete Blood Count (CBC)', 'Hemoglobin', '11.6', '2026-05-19 01:35:00+00'::timestamptz),
    ('ka.seed.analytics.maria.santos@example.test', 'Complete Blood Count (CBC)', 'Hemoglobin', '12.3', '2026-06-18 01:50:00+00'::timestamptz),
    ('ka.seed.analytics.maria.santos@example.test', 'Complete Blood Count (CBC)', 'Hemoglobin', '13.1', '2026-07-14 02:05:00+00'::timestamptz),

    -- Dr. Jojo: FBS persistent borderline/high trend.
    ('ka.seed.analytics.liza.delacruz@example.test', 'Fasting Blood Sugar (FBS)', 'Fasting Blood Sugar (FBS)', '96', '2026-04-25 02:10:00+00'::timestamptz),
    ('ka.seed.analytics.liza.delacruz@example.test', 'Fasting Blood Sugar (FBS)', 'Fasting Blood Sugar (FBS)', '108', '2026-05-23 02:25:00+00'::timestamptz),
    ('ka.seed.analytics.liza.delacruz@example.test', 'Fasting Blood Sugar (FBS)', 'Fasting Blood Sugar (FBS)', '126', '2026-07-09 02:40:00+00'::timestamptz),
    ('ka.seed.analytics.liza.delacruz@example.test', 'Fasting Blood Sugar (FBS)', 'Fasting Blood Sugar (FBS)', '118', '2026-07-12 02:55:00+00'::timestamptz),
    ('ka.seed.analytics.liza.delacruz@example.test', 'Fasting Blood Sugar (FBS)', 'Fasting Blood Sugar (FBS)', '101', '2026-07-14 03:10:00+00'::timestamptz),

    -- Dr. Jojo: renal and CBC mixed patients.
    ('ka.seed.analytics.ramon.garcia@example.test', 'Renal Function', 'Creatinine', '0.9', '2026-05-02 04:20:00+00'::timestamptz),
    ('ka.seed.analytics.ramon.garcia@example.test', 'Renal Function', 'Creatinine', '1.1', '2026-06-03 04:25:00+00'::timestamptz),
    ('ka.seed.analytics.ramon.garcia@example.test', 'Renal Function', 'Creatinine', '1.6', '2026-07-10 04:30:00+00'::timestamptz),

    ('ka.seed.analytics.andrea.lim@example.test', 'Complete Blood Count (CBC)', 'Hemoglobin', '13.4', '2026-06-15 05:30:00+00'::timestamptz),
    ('ka.seed.analytics.andrea.lim@example.test', 'Complete Blood Count (CBC)', 'White Blood Cells (WBC)', '7.8', '2026-06-15 05:30:00+00'::timestamptz),
    ('ka.seed.analytics.andrea.lim@example.test', 'Complete Blood Count (CBC)', 'Platelets', '315', '2026-06-15 05:30:00+00'::timestamptz),
    ('ka.seed.analytics.andrea.lim@example.test', 'Complete Blood Count (CBC)', 'Hemoglobin', '12.8', '2026-07-11 05:45:00+00'::timestamptz),
    ('ka.seed.analytics.andrea.lim@example.test', 'Complete Blood Count (CBC)', 'White Blood Cells (WBC)', '14.2', '2026-07-11 05:45:00+00'::timestamptz),
    ('ka.seed.analytics.andrea.lim@example.test', 'Complete Blood Count (CBC)', 'Platelets', '288', '2026-07-11 05:45:00+00'::timestamptz),

    ('ka.seed.analytics.noel.bautista@example.test', 'Complete Blood Count (CBC)', 'Hemoglobin', '15.1', '2026-06-08 03:20:00+00'::timestamptz),
    ('ka.seed.analytics.noel.bautista@example.test', 'Complete Blood Count (CBC)', 'White Blood Cells (WBC)', '6.9', '2026-06-08 03:20:00+00'::timestamptz),
    ('ka.seed.analytics.noel.bautista@example.test', 'Complete Blood Count (CBC)', 'Platelets', '226', '2026-06-08 03:20:00+00'::timestamptz),
    ('ka.seed.analytics.noel.bautista@example.test', 'Complete Blood Count (CBC)', 'Hemoglobin', '14.2', '2026-07-12 03:25:00+00'::timestamptz),
    ('ka.seed.analytics.noel.bautista@example.test', 'Complete Blood Count (CBC)', 'White Blood Cells (WBC)', '8.2', '2026-07-12 03:25:00+00'::timestamptz),
    ('ka.seed.analytics.noel.bautista@example.test', 'Complete Blood Count (CBC)', 'Platelets', '118', '2026-07-12 03:25:00+00'::timestamptz),

    ('ka.seed.analytics.patricia.mendoza@example.test', 'Fasting Blood Sugar (FBS)', 'Fasting Blood Sugar (FBS)', '88', '2026-05-11 04:35:00+00'::timestamptz),
    ('ka.seed.analytics.patricia.mendoza@example.test', 'Fasting Blood Sugar (FBS)', 'Fasting Blood Sugar (FBS)', '142', '2026-07-13 04:40:00+00'::timestamptz),
    ('ka.seed.analytics.patricia.mendoza@example.test', 'Lipid Profile', 'Cholesterol', '184', '2026-06-09 04:45:00+00'::timestamptz),

    ('ka.seed.analytics.tomas.aquino@example.test', 'Lipid Profile', 'Cholesterol', '197', '2026-05-18 05:10:00+00'::timestamptz),
    ('ka.seed.analytics.tomas.aquino@example.test', 'Lipid Profile', 'Cholesterol', '248', '2026-07-14 05:20:00+00'::timestamptz),
    ('ka.seed.analytics.tomas.aquino@example.test', 'Renal Function', 'Creatinine', '1.0', '2026-06-22 05:15:00+00'::timestamptz),

    ('ka.seed.analytics.mika.flores@example.test', 'Fasting Blood Sugar (FBS)', 'Fasting Blood Sugar (FBS)', '92', '2026-06-12 01:45:00+00'::timestamptz),
    ('ka.seed.analytics.mika.flores@example.test', 'Renal Function', 'Creatinine', '1.1', '2026-07-04 01:50:00+00'::timestamptz),
    ('ka.seed.analytics.elena.navarro@example.test', 'Complete Blood Count (CBC)', 'Hemoglobin', '12.7', '2026-07-06 02:45:00+00'::timestamptz),
    ('ka.seed.analytics.elena.navarro@example.test', 'Complete Blood Count (CBC)', 'White Blood Cells (WBC)', '10.5', '2026-07-06 02:45:00+00'::timestamptz),
    ('ka.seed.analytics.elena.navarro@example.test', 'Complete Blood Count (CBC)', 'Platelets', '462', '2026-07-06 02:45:00+00'::timestamptz),
    ('ka.seed.analytics.paolo.villanueva@example.test', 'Renal Function', 'Creatinine', '1.3', '2026-07-02 03:10:00+00'::timestamptz),
    ('ka.seed.analytics.paolo.villanueva@example.test', 'Lipid Profile', 'Cholesterol', '188', '2026-06-02 03:15:00+00'::timestamptz),
    ('ka.seed.analytics.jessa.cruz@example.test', 'Fasting Blood Sugar (FBS)', 'Fasting Blood Sugar (FBS)', '84', '2026-07-05 04:10:00+00'::timestamptz),
    ('ka.seed.analytics.jessa.cruz@example.test', 'Complete Blood Count (CBC)', 'Hemoglobin', '13.0', '2026-06-05 04:20:00+00'::timestamptz),
    ('ka.seed.analytics.jessa.cruz@example.test', 'Complete Blood Count (CBC)', 'White Blood Cells (WBC)', '5.6', '2026-06-05 04:20:00+00'::timestamptz),
    ('ka.seed.analytics.jessa.cruz@example.test', 'Complete Blood Count (CBC)', 'Platelets', '250', '2026-06-05 04:20:00+00'::timestamptz),

    -- Janine: female creatinine gender-aware trend.
    ('ka.seed.analytics.ana.mercado@example.test', 'Renal Function', 'Creatinine', '0.8', '2026-04-24 02:15:00+00'::timestamptz),
    ('ka.seed.analytics.ana.mercado@example.test', 'Renal Function', 'Creatinine', '1.0', '2026-05-24 02:25:00+00'::timestamptz),
    ('ka.seed.analytics.ana.mercado@example.test', 'Renal Function', 'Creatinine', '1.2', '2026-07-09 02:35:00+00'::timestamptz),
    ('ka.seed.analytics.ana.mercado@example.test', 'Renal Function', 'Creatinine', '1.3', '2026-07-13 02:45:00+00'::timestamptz),

    ('ka.seed.analytics.miguel.tan@example.test', 'Renal Function', 'Creatinine', '0.8', '2026-05-05 03:15:00+00'::timestamptz),
    ('ka.seed.analytics.miguel.tan@example.test', 'Renal Function', 'Creatinine', '1.0', '2026-06-05 03:20:00+00'::timestamptz),
    ('ka.seed.analytics.miguel.tan@example.test', 'Renal Function', 'Creatinine', '1.5', '2026-07-10 03:25:00+00'::timestamptz),

    ('ka.seed.analytics.grace.ramos@example.test', 'Complete Blood Count (CBC)', 'Hemoglobin', '12.4', '2026-06-11 04:15:00+00'::timestamptz),
    ('ka.seed.analytics.grace.ramos@example.test', 'Complete Blood Count (CBC)', 'White Blood Cells (WBC)', '13.4', '2026-07-11 04:25:00+00'::timestamptz),
    ('ka.seed.analytics.grace.ramos@example.test', 'Complete Blood Count (CBC)', 'Platelets', '298', '2026-07-11 04:25:00+00'::timestamptz),

    ('ka.seed.analytics.roberto.sy@example.test', 'Complete Blood Count (CBC)', 'Hemoglobin', '14.5', '2026-06-14 05:15:00+00'::timestamptz),
    ('ka.seed.analytics.roberto.sy@example.test', 'Complete Blood Count (CBC)', 'White Blood Cells (WBC)', '7.1', '2026-06-14 05:15:00+00'::timestamptz),
    ('ka.seed.analytics.roberto.sy@example.test', 'Complete Blood Count (CBC)', 'Platelets', '315', '2026-06-14 05:15:00+00'::timestamptz),
    ('ka.seed.analytics.roberto.sy@example.test', 'Complete Blood Count (CBC)', 'Hemoglobin', '13.9', '2026-07-14 05:30:00+00'::timestamptz),
    ('ka.seed.analytics.roberto.sy@example.test', 'Complete Blood Count (CBC)', 'White Blood Cells (WBC)', '9.2', '2026-07-14 05:30:00+00'::timestamptz),
    ('ka.seed.analytics.roberto.sy@example.test', 'Complete Blood Count (CBC)', 'Platelets', '120', '2026-07-14 05:30:00+00'::timestamptz),

    ('ka.seed.analytics.kara.lopez@example.test', 'Lipid Profile', 'Cholesterol', '176', '2026-05-21 01:50:00+00'::timestamptz),
    ('ka.seed.analytics.kara.lopez@example.test', 'Lipid Profile', 'Cholesterol', '204', '2026-07-07 02:00:00+00'::timestamptz),
    ('ka.seed.analytics.daniel.castillo@example.test', 'Fasting Blood Sugar (FBS)', 'Fasting Blood Sugar (FBS)', '95', '2026-05-27 02:50:00+00'::timestamptz),
    ('ka.seed.analytics.daniel.castillo@example.test', 'Fasting Blood Sugar (FBS)', 'Fasting Blood Sugar (FBS)', '110', '2026-07-01 03:00:00+00'::timestamptz),
    ('ka.seed.analytics.irene.chua@example.test', 'Complete Blood Count (CBC)', 'Hemoglobin', '13.8', '2026-07-03 03:50:00+00'::timestamptz),
    ('ka.seed.analytics.irene.chua@example.test', 'Complete Blood Count (CBC)', 'White Blood Cells (WBC)', '6.2', '2026-07-03 03:50:00+00'::timestamptz),
    ('ka.seed.analytics.irene.chua@example.test', 'Complete Blood Count (CBC)', 'Platelets', '275', '2026-07-03 03:50:00+00'::timestamptz),
    ('ka.seed.analytics.victor.ong@example.test', 'Renal Function', 'Creatinine', '1.2', '2026-07-06 04:50:00+00'::timestamptz),
    ('ka.seed.analytics.victor.ong@example.test', 'Lipid Profile', 'Cholesterol', '195', '2026-06-25 05:00:00+00'::timestamptz),
    ('ka.seed.analytics.lea.gonzales@example.test', 'Fasting Blood Sugar (FBS)', 'Fasting Blood Sugar (FBS)', '76', '2026-07-05 01:25:00+00'::timestamptz),
    ('ka.seed.analytics.lea.gonzales@example.test', 'Lipid Profile', 'Cholesterol', '216', '2026-06-29 01:35:00+00'::timestamptz),
    ('ka.seed.analytics.omar.santos@example.test', 'Complete Blood Count (CBC)', 'Hemoglobin', '15.0', '2026-07-04 02:25:00+00'::timestamptz),
    ('ka.seed.analytics.omar.santos@example.test', 'Complete Blood Count (CBC)', 'White Blood Cells (WBC)', '5.0', '2026-07-04 02:25:00+00'::timestamptz),
    ('ka.seed.analytics.omar.santos@example.test', 'Complete Blood Count (CBC)', 'Platelets', '210', '2026-07-04 02:25:00+00'::timestamptz),
    ('ka.seed.analytics.nina.torres@example.test', 'Fasting Blood Sugar (FBS)', 'Fasting Blood Sugar (FBS)', '102', '2026-07-02 03:25:00+00'::timestamptz),
    ('ka.seed.analytics.benjie.rivera@example.test', 'Lipid Profile', 'Cholesterol', '199', '2026-06-19 04:25:00+00'::timestamptz),
    ('ka.seed.analytics.benjie.rivera@example.test', 'Lipid Profile', 'Cholesterol', '232', '2026-07-07 04:35:00+00'::timestamptz)
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
    '[KA_REDEFENSE_ANALYTICS_SEED_20260715] Demo trend data for redefense analytics.'::text as notes,
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

-- Post-insert validation.
select count(*) as seed_patients
from public.specialist_patients
where email like 'ka.seed.analytics.%@example.test';

select test_type, count(*) as rows
from public.specialist_records
where notes like '%[KA_REDEFENSE_ANALYTICS_SEED_20260715]%'
group by test_type
order by test_type;

select is_flagged, count(*) as rows
from public.specialist_records
where notes like '%[KA_REDEFENSE_ANALYTICS_SEED_20260715]%'
group by is_flagged
order by is_flagged;

select count(*) as flagged_since_2026_07_08
from public.specialist_records
where notes like '%[KA_REDEFENSE_ANALYTICS_SEED_20260715]%'
  and is_flagged = true
  and created_at >= '2026-07-08 00:00:00+00'::timestamptz;

select test_name, count(*) as rows, min(created_at) as first_date, max(created_at) as latest_date
from public.specialist_records
where notes like '%[KA_REDEFENSE_ANALYTICS_SEED_20260715]%'
group by test_name
order by test_name;

select sp.email, sr.test_name, count(*) as points
from public.specialist_patients sp
join public.specialist_records sr on sr.specialist_patient_id = sp.id
where sp.email like 'ka.seed.analytics.%@example.test'
group by sp.email, sr.test_name
having count(*) >= 3
order by points desc, sp.email, sr.test_name;

commit;
