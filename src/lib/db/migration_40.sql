-- KlinikAid Migration 40: lab result plausibility enforced in the database (#204)
--
-- Why: plausibleMin/plausibleMax live only in application code.
-- src/lib/constants.ts declares them, src/lib/records/validateLabResult.ts
-- enforces them, and web enforces them in the two places it writes lab results:
-- POST /api/department/records and the specialist record server action. The
-- mobile app writes public.department_records and public.specialist_records
-- straight through PostgREST under the user's own JWT, so web's validation
-- never sees those writes, and a mobile build with no check of its own can
-- store anything: in schema.sql, test_value is just `text NOT NULL`. Issue #204
-- found one divergence already -- mobile accepted "5." where web refuses it.
--
-- This moves that one rule into the database, where every writer meets it,
-- without changing either client's write path.
--
-- What this adds:
--
--   lab_plausibility_limits
--     One row per numeric lab parameter -- the six entries of
--     LAB_REFERENCE_RANGES -- seeded from src/lib/constants.ts:
--         (test_name primary key, plausible_min, plausible_max, unit)
--     RLS enabled with a SELECT policy for authenticated only: clients may
--     read the limits (to show them) but hold no write privilege, so they
--     cannot widen a bound. The seed is an upsert, so re-running this file
--     restores exactly what constants.ts declares. No application row is ever
--     inserted, updated or deleted by this file.
--
--   enforce_lab_plausibility()
--     A BEFORE INSERT OR UPDATE trigger function, fired by one trigger on each
--     of public.department_records and public.specialist_records. For a row
--     whose test_name matches a limited parameter it refuses a test_value that
--     is not strict-numeric or is outside [plausible_min, plausible_max],
--     with SQLSTATE 23514 (check_violation) and web's own refusal sentence as
--     the message. It never rewrites NEW.test_value: a value that passes is
--     stored exactly as entered (issue #204 acceptance).
--
--     Matching test_name: byte for byte, the same test validateLabResult.ts
--     does -- `LAB_REFERENCE_RANGES.find((ref) => ref.parameter === testName)`
--     -- with no case folding and no trimming (the panel path's
--     `allowed.includes(test_name)` is the same). So narrative rows (Findings,
--     Impression), every free-text name the other departments record, and any
--     name outside LAB_REFERENCE_RANGES are left alone, exactly as web leaves
--     them alone. CLINIC_TEST_CATALOG's aliases ("wbc", "fbs", ...) are a
--     search convenience for the catalog UI: neither client stores them in
--     test_name and validateLabResult would not recognise them either, so
--     there are no aliases here.
--
--     department_records: checked only when department = 'laboratory'. Web
--     routes only laboratory rows through validateLabSubmission (route.ts,
--     `dept === "laboratory"`); imaging, ultrasound and ECG record free-text
--     Findings/Impression and are not lab parameters. specialist_records has
--     no department column, and web's specialist action validates every row it
--     writes (validateLabPanel admits panel parameters only), so there test_name
--     alone decides.
--
--     Gender: nothing here reads it. The male/female numbers in
--     LAB_REFERENCE_RANGES are *reference* ranges, which decide is_flagged;
--     plausibility bounds are deliberately gender-independent, and
--     validateLabResult refuses on plausibleMin/plausibleMax alone.
--
--     SECURITY DEFINER, not invoker: the guard must reach the same verdict for
--     every writer. Under SECURITY INVOKER the lookup of the limits would be
--     filtered by the caller's own RLS, and RLS removes rows instead of
--     raising, so a role that could write a record but not read the limits
--     would have its check silently skipped -- a guard that turns itself off.
--     DEFINER costs nothing here: the function only SELECTs that one reference
--     table, writes nothing, and runs with `set search_path = ''` against a
--     schema-qualified table, so it cannot be redirected by a shadowing schema
--     (the shape of sync_profile_legacy_role in migration 35). It is a trigger
--     function, so it is not callable over PostgREST even though EXECUTE keeps
--     its default grant.
--
-- What clients see on a refusal: PostgREST answers HTTP 400 with
-- `{"code":"23514","message":"<web's sentence>","details":null,"hint":null}`,
-- i.e. `error.code === "23514"` and that sentence in `error.message`. The
-- whole statement aborts, so a batch containing one implausible value writes
-- nothing.
--
-- PRE-FLIGHT: run this query first, before applying anything in this file.
-- It must return zero rows:
--
--   select bad.table_name, bad.test_name, count(*) as violating_rows,
--          string_agg(distinct bad.test_value, ', ') as example_values
--     from (
--           select 'department_records' as table_name, d.test_name,
--                  btrim(d.test_value) as test_value
--             from public.department_records d
--            where d.department = 'laboratory'
--           union all
--           select 'specialist_records', s.test_name, btrim(s.test_value)
--             from public.specialist_records s
--          ) bad
--     join (
--           values ('Hemoglobin', 1, 25, 'g/dL'),
--                  ('White Blood Cells (WBC)', 0, 1000, 'x10^3/µL'),
--                  ('Platelets', 0, 5000, 'x10^3/µL'),
--                  ('Fasting Blood Sugar (FBS)', 5, 3000, 'mg/dL'),
--                  ('Creatinine', 0.1, 40, 'mg/dL'),
--                  ('Cholesterol', 20, 2000, 'mg/dL')
--          ) limits (test_name, plausible_min, plausible_max, unit)
--           on limits.test_name = bad.test_name
--    where case
--            when bad.test_value ~ '^-?\d+(\.\d+)?$'
--              then bad.test_value::numeric
--                   not between limits.plausible_min and limits.plausible_max
--            else true
--          end
--    group by bad.table_name, bad.test_name
--    order by bad.table_name, bad.test_name;
--
-- If it returns rows, stop: do not apply this file, and do not delete or update
-- anything to make it pass. Those rows are a data question for someone to
-- decide on, not something this migration may resolve. The gate inside the
-- transaction repeats the same count against the table this file creates and
-- raises, so applying without the pre-flight stops there too instead of
-- half-applying -- and it rolls back the DDL above it with it. This file never
-- deletes or updates a single row.
--
-- ORDERING: independent of the application deploy. Web already applies these
-- exact rules before it inserts, so its own writes never reach the guard;
-- applying this changes nothing for web. What changes is for writers that
-- bypass web's validation -- the mobile app's direct PostgREST inserts -- which
-- now get the refusal. Tell the mobile app the error shape above
-- (JudgementKazzy2023/Klinikaid-Mobile-App, parity with issue #204) so it can
-- show it instead of a generic save failure.
--
-- SNAPSHOT: src/lib/db/schema.sql is a generated picture of the live database,
-- so it is NOT regenerated in this change: this migration has not been applied
-- yet, and the live database has neither this table nor these triggers.
-- Regenerate the snapshot (procedure in documentation/DATABASE.md) after
-- applying this file, so that a fresh project bootstrapped from the snapshot
-- enforces the same rule.
--
-- ROLLBACK:
--   begin;
--   drop trigger if exists department_records_lab_plausibility on public.department_records;
--   drop trigger if exists specialist_records_lab_plausibility on public.specialist_records;
--   drop function if exists public.enforce_lab_plausibility();
--   drop table if exists public.lab_plausibility_limits;
--   commit;
--   Dropping the table drops the limits with it; no stored test_value is
--   affected either way.

begin;

create table if not exists public.lab_plausibility_limits (
  test_name     text    primary key,
  plausible_min numeric not null,
  plausible_max numeric not null,
  unit          text,
  constraint lab_plausibility_limits_bounds check (plausible_min <= plausible_max)
);

alter table public.lab_plausibility_limits enable row level security;

-- Readable by authenticated, writable by nobody's client session. The trigger
-- is SECURITY DEFINER, so enforcement does not depend on these grants.
revoke all on table public.lab_plausibility_limits from public, anon, authenticated;
grant select on table public.lab_plausibility_limits to authenticated, service_role;

drop policy if exists "Authenticated users can read lab plausibility limits"
  on public.lab_plausibility_limits;

create policy "Authenticated users can read lab plausibility limits"
  on public.lab_plausibility_limits for select
  to authenticated
  using (true);

-- Seed from src/lib/constants.ts LAB_REFERENCE_RANGES, in that order:
-- parameter, plausibleMin, plausibleMax, unit. An upsert, so a re-run restores
-- the declared bounds instead of quietly keeping an edited row.
insert into public.lab_plausibility_limits
  (test_name, plausible_min, plausible_max, unit)
values
  ('Hemoglobin', 1, 25, 'g/dL'),
  ('White Blood Cells (WBC)', 0, 1000, 'x10^3/µL'),
  ('Platelets', 0, 5000, 'x10^3/µL'),
  ('Fasting Blood Sugar (FBS)', 5, 3000, 'mg/dL'),
  ('Creatinine', 0.1, 40, 'mg/dL'),
  ('Cholesterol', 20, 2000, 'mg/dL')
on conflict (test_name) do update
  set plausible_min = excluded.plausible_min,
      plausible_max = excluded.plausible_max,
      unit           = excluded.unit;

-- SHARE conflicts with ROW EXCLUSIVE, so no row can be inserted or updated
-- between this gate and the triggers below: the count cannot be passed by a
-- write committed concurrently. Readers are unaffected.
lock table public.department_records, public.specialist_records in share mode;

-- The gate: it only reads. If an existing row would now be refused, it raises
-- and the whole transaction -- including the table and seed above -- is
-- aborted, so this file applies completely or not at all, and never deletes or
-- updates a row to make itself fit. CASE, not AND/OR: only CASE guarantees that
-- the ::numeric cast is reached with a value the regex has already accepted.
do $$
declare
  v_count    integer;
  v_examples text;
begin
  select count(*),
         string_agg(format('%s.%s = %s', bad.table_name, bad.test_name, bad.test_value),
                    '; ' order by bad.table_name, bad.test_name)
    into v_count, v_examples
    from (
          select 'department_records' as table_name, d.test_name,
                 btrim(d.test_value) as test_value
            from public.department_records d
           where d.department = 'laboratory'
          union all
          select 'specialist_records', s.test_name, btrim(s.test_value)
            from public.specialist_records s
         ) bad
    join public.lab_plausibility_limits limits
      on limits.test_name = bad.test_name
   where case
           when bad.test_value ~ '^-?\d+(\.\d+)?$'
             then bad.test_value::numeric
                  not between limits.plausible_min and limits.plausible_max
           else true
         end;

  if v_count > 0 then
    raise exception
      'migration_40: % existing lab result row(s) would be refused by the plausibility rule. This migration never deletes or updates data; resolve these by hand first: %',
      v_count, coalesce(v_examples, '')
      using errcode = '23514';
  end if;
end;
$$;

create or replace function public.enforce_lab_plausibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_test_name text;
  v_value     text;
  v_min       numeric;
  v_max       numeric;
  v_unit      text;
begin
  -- A NULL name or value is the column's NOT NULL constraint to refuse, not a
  -- plausibility question.
  if new.test_name is null or new.test_value is null then
    return new;
  end if;

  -- Only laboratory rows of department_records: the other departments record
  -- free-text Findings and Impression, which are not lab parameters. Nested IF
  -- rather than one `and` expression: plpgsql gives no short-circuit guarantee,
  -- and new.department does not exist on specialist_records.
  if TG_TABLE_NAME = 'department_records' then
    if new.department is distinct from 'laboratory' then
      return new;
    end if;
  end if;

  -- Byte-for-byte, the matching validateLabResult does (no case folding, no
  -- trimming). Unlisted names -- narrative rows and everything the other
  -- departments record -- return no row and are not this guard's business.
  select l.test_name, l.plausible_min, l.plausible_max, l.unit
    into v_test_name, v_min, v_max, v_unit
    from public.lab_plausibility_limits l
   where l.test_name = new.test_name;

  if not found then
    return new;
  end if;

  -- Web trims before it tests and stores the trimmed text. The stored value is
  -- never rewritten here: a value that passes is kept exactly as entered.
  v_value := btrim(new.test_value);

  -- STRICT_NUMBER_REGEX from validateLabResult.ts, verbatim. Sequence matters:
  -- two statements, so the cast below can only see a value the regex accepted.
  if v_value !~ '^-?\d+(\.\d+)?$' then
    raise exception
      '%: "%" is not a valid number. Enter digits with an optional decimal point, e.g. 95 or 13.2.',
      v_test_name, v_value
      using errcode = '23514';
  end if;

  -- Inclusive bounds, and web's own sentence: validateLabResult.ts builds
  -- `${testName}: ${value} ${unit} is outside the possible range
  -- (${plausibleMin}–${plausibleMax} ${unit}). Check the value and its unit.`
  if v_value::numeric not between v_min and v_max then
    raise exception
      '%: % % is outside the possible range (%–% %). Check the value and its unit.',
      v_test_name, v_value, v_unit, v_min, v_max, v_unit
      using errcode = '23514';
  end if;

  return new;
end;
$$;

-- A trigger function is never called directly. EXECUTE is checked when a
-- trigger is created, not when it fires, so revoking it from client roles
-- keeps this SECURITY DEFINER function off the API surface without
-- weakening the guard.
revoke execute on function public.enforce_lab_plausibility() from public, anon, authenticated;

drop trigger if exists department_records_lab_plausibility on public.department_records;

create trigger department_records_lab_plausibility
  before insert or update on public.department_records
  for each row
  execute function public.enforce_lab_plausibility();

drop trigger if exists specialist_records_lab_plausibility on public.specialist_records;

create trigger specialist_records_lab_plausibility
  before insert or update on public.specialist_records
  for each row
  execute function public.enforce_lab_plausibility();

commit;
