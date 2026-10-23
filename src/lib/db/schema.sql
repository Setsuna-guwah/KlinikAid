-- KlinikAid GENERATED current-state snapshot through migration_40 (2026-10-23).
-- Fresh Supabase projects ONLY: run this file once in the SQL editor, or:
--   psql "$FRESH_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f src/lib/db/schema.sql
-- Requires a Supabase database with auth/storage schemas and platform roles.
-- Does not reset existing data: a second run fails before changing anything.
-- Existing projects: apply only migrations newer than their recorded history.
--
-- Regenerate after EVERY migration; do not hand-maintain the public DDL below.
-- Source command (PostgreSQL 17 pg_dump, schema only, retaining ACLs):
--   pg_dump "$SOURCE_DATABASE_URL" --schema-only --schema=public --no-owner > public.sql
-- See documentation/DATABASE.md for sanitisation, reference data and other-schema
-- objects that must accompany the dump. Never commit a data dump or credentials.

BEGIN;
DO $bootstrap$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public') THEN
    RAISE EXCEPTION 'KlinikAid bootstrap requires an empty public schema; use newer migrations for an existing database';
  END IF;
END;
$bootstrap$;

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.11 (Debian 17.11-0+deb13u1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--




--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: allocate_queue_number(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.allocate_queue_number(p_department text, OUT allocated_date date, OUT allocated_number integer) RETURNS record
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_day_start timestamptz;
  v_seed integer;
begin
  if not public.user_has_permission(auth.uid(), 'queue.manage') then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  if p_department is null or p_department not in ('laboratory', 'imaging', 'ultrasound', 'ecg') then
    raise exception 'invalid department' using errcode = '22023';
  end if;

  allocated_date := (now() at time zone 'Asia/Manila')::date;

  update public.queue_number_counters c
     set last_number = c.last_number + 1
   where c.department = p_department
     and c.queue_date = allocated_date
  returning c.last_number into allocated_number;

  if found then
    return;
  end if;

  -- First allocation for this department today: start above anything the day
  -- already holds, including entries numbered by the previous code.
  v_day_start := allocated_date::timestamp at time zone 'Asia/Manila';

  select greatest(
           count(*),
           coalesce(max(q.queue_number) filter (where q.queue_date = allocated_date), 0),
           coalesce(max(substring(q.triage_notes from '"queue_number"\s*:\s*"[A-Z]+-(\d{1,9})"')::integer), 0)
         )
    into v_seed
    from public.patient_queue q
   where q.department = p_department
     and (q.queue_date = allocated_date
          or (q.created_at >= v_day_start and q.created_at < v_day_start + interval '1 day'));

  insert into public.queue_number_counters as c (department, queue_date, last_number)
  values (p_department, allocated_date, v_seed + 1)
  on conflict (department, queue_date)
    do update set last_number = c.last_number + 1
  returning c.last_number into allocated_number;
end;
$$;


--
-- Name: archive_specialist_patient(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.archive_specialist_patient(p_patient_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: auth_session_satisfies_mfa(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auth_session_satisfies_mfa() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    coalesce(auth.role(), '') <> 'authenticated'
    or coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    or exists (
      select 1
      from public.profiles p
      join public.roles r on r.id = p.role_id
      where p.id = auth.uid()
        and p.role = 'patient'
        and r.name = 'patient'
    );
$$;


--
-- Name: begin_login_attempt(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.begin_login_attempt(p_email text, p_ip text, OUT allowed boolean, OUT retry_after timestamp with time zone) RETURNS record
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  max_attempts constant integer  := 5;
  window_len   constant interval := interval '15 minutes';
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_ip    text := coalesce(p_ip, '');
  r public.login_attempts;
begin
  -- Rows for emails nobody signs in with again would otherwise accumulate.
  delete from public.login_attempts
   where window_start < now() - interval '1 day'
     and (locked_until is null or locked_until < now());

  insert into public.login_attempts (email_key, ip)
  values (v_email, v_ip)
  on conflict do nothing;

  -- Row lock: concurrent submissions are counted one at a time, so firing
  -- requests in parallel does not buy extra guesses.
  select * into r
    from public.login_attempts
   where email_key = v_email and ip = v_ip
     for update;

  if r.locked_until is not null and r.locked_until > now() then
    allowed := false;
    retry_after := r.locked_until;
    return;
  end if;

  -- Window over, or a lock that has been served: start counting afresh.
  if r.window_start <= now() - window_len or r.locked_until is not null then
    r.attempts := 0;
    r.window_start := now();
  end if;

  if r.attempts >= max_attempts then
    update public.login_attempts
       set locked_until = now() + window_len
     where email_key = v_email and ip = v_ip
    returning locked_until into retry_after;
    allowed := false;
    return;
  end if;

  update public.login_attempts
     set attempts = r.attempts + 1,
         window_start = r.window_start,
         locked_until = null
   where email_key = v_email and ip = v_ip;

  allowed := true;
  retry_after := null;
end;
$$;


--
-- Name: claim_totp_code(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_totp_code(p_factor_id uuid, p_code text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  inserted integer;
begin
  -- A 30-second step accepted with one step of clock skew either side is valid
  -- for at most 90 seconds; 5 minutes is comfortably past that.
  delete from public.used_totp_codes
   where used_at < now() - interval '5 minutes';

  insert into public.used_totp_codes (factor_id, code)
  values (p_factor_id, p_code)
  on conflict do nothing;

  get diagnostics inserted = row_count;
  return inserted = 1;
end;
$$;


--
-- Name: cleanup_expired_verification_codes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_expired_verification_codes() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  delete from public.email_verification_codes
  where expires_at < now() - interval '24 hours';
end;
$$;


--
-- Name: clear_login_attempts(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clear_login_attempts(p_email text, p_ip text) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  delete from public.login_attempts
   where email_key = lower(btrim(coalesce(p_email, '')))
     and ip = coalesce(p_ip, '');
$$;


--
-- Name: create_custom_role(text, text, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_custom_role(p_name text, p_description text, p_permission_ids uuid[]) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_name text;
  v_role public.roles;
begin
  v_name := public.validate_custom_role_input(null, p_name, p_permission_ids);

  insert into public.roles (name, description, is_system, base_role)
  values (v_name, p_description, false, 'receptionist')
  returning * into v_role;

  insert into public.role_permissions (role_id, permission_id)
  select v_role.id, x from unnest(p_permission_ids) x;

  return jsonb_build_object(
    'role_id', v_role.id,
    'role_name', v_role.name,
    'base_role', v_role.base_role,
    'permission_count', cardinality(p_permission_ids)
  );
end;
$$;


--
-- Name: enforce_lab_plausibility(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_lab_plausibility() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
$_$;


--
-- Name: get_auth_user_dept(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_auth_user_dept() RETURNS text
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select department from public.profiles
  where id = auth.uid() and is_active and public.auth_session_satisfies_mfa();
$$;


--
-- Name: get_auth_user_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_auth_user_role() RETURNS text
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select role from public.profiles
  where id = auth.uid() and is_active and public.auth_session_satisfies_mfa();
$$;


--
-- Name: get_daily_token_usage(timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_daily_token_usage(start_date timestamp with time zone) RETURNS TABLE(date date, total_tokens bigint, query_count bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT DATE(created_at AT TIME ZONE 'Asia/Manila') AS date,
         COALESCE(SUM(tokens_used), 0)::BIGINT        AS total_tokens,
         COUNT(*)::BIGINT                            AS query_count
  FROM   public.chatbot_logs
  WHERE  created_at >= start_date
  GROUP  BY DATE(created_at AT TIME ZONE 'Asia/Manila')
  ORDER  BY date ASC;
$$;


--
-- Name: get_role_for_email(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_role_for_email(email_address text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
DECLARE
  found_role text;
BEGIN
  SELECT p.role INTO found_role
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE u.email = email_address;
  
  RETURN found_role;  -- NULL for unknown, actual role for known
END;
$$;


--
-- Name: get_user_id_by_email(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_id_by_email(email_address text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'auth', 'public'
    AS $$
DECLARE
  user_id uuid;
BEGIN
  SELECT id INTO user_id FROM auth.users WHERE email = email_address LIMIT 1;
  RETURN user_id;
END;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  default_name text;
  claimed_role text;
  patient_role_id uuid;
begin
  default_name := coalesce(new.raw_user_meta_data->>'full_name', 'New User');
  claimed_role := coalesce(
    new.raw_user_meta_data->>'role',
    new.raw_app_meta_data->>'role'
  );

  select id into patient_role_id
  from public.roles
  where name = 'patient';

  if patient_role_id is null then
    begin
      insert into public.system_logs (user_id, event_type, description, metadata)
      values (new.id, 'PROFILE_PROVISIONING_FAILED',
        'Profile provisioning failed: patient role_id could not be resolved',
        jsonb_build_object('reason', 'missing_patient_role_id'));
    exception when others then null;
    end;

    raise exception 'Profile provisioning failed: patient role_id could not be resolved';
  end if;

  -- Self-service signup is always a patient. Staff role is assigned by the
  -- server after creation, never from anything the caller supplied.
  insert into public.profiles (id, full_name, role, department, role_id)
  values (new.id, default_name, 'patient', null, patient_role_id);

  begin
    if claimed_role is not null and claimed_role <> 'patient' then
      insert into public.system_logs (user_id, event_type, description, metadata)
      values (new.id, 'SIGNUP_ROLE_CLAIM_IGNORED',
        'Signup supplied a privileged role that was not honoured; provisioned as patient',
        jsonb_build_object('claimed_role', claimed_role, 'granted_role', 'patient'));
    end if;

    insert into public.system_logs (user_id, event_type, description, metadata)
    values (new.id, 'USER_REGISTERED',
      'User account created automatically: ' || default_name || ' (patient)',
      jsonb_build_object('role', 'patient', 'department', null, 'role_id', patient_role_id));
  exception when others then null;
  end;

  return new;
exception
  when others then
    begin
      insert into public.system_logs (user_id, event_type, description, metadata)
      values (new.id, 'PROFILE_PROVISIONING_FAILED',
        'Profile provisioning failed during signup trigger',
        jsonb_build_object('error', sqlerrm));
    exception when others then null;
    end;

    raise;
end;
$$;


--
-- Name: match_documents(public.vector, double precision, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_documents(query_embedding public.vector, match_threshold double precision, match_count integer) RETURNS TABLE(id uuid, title text, content text, metadata jsonb, similarity double precision)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    rag_documents.id,
    rag_documents.title,
    rag_documents.content,
    rag_documents.metadata,
    1 - (rag_documents.embedding <=> query_embedding) AS similarity
  FROM rag_documents
  WHERE 1 - (rag_documents.embedding <=> query_embedding) > match_threshold
  ORDER BY rag_documents.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;


--
-- Name: prevent_system_role_deletion(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_system_role_deletion() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.is_system THEN
    RAISE EXCEPTION 'Cannot delete system roles.';
  END IF;
  RETURN OLD;
END;
$$;


--
-- Name: refund_login_attempt(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refund_login_attempt(p_email text, p_ip text) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  update public.login_attempts
     set attempts = greatest(attempts - 1, 0)
   where email_key = lower(btrim(coalesce(p_email, '')))
     and ip = coalesce(p_ip, '')
     and (locked_until is null or locked_until <= now());
$$;


--
-- Name: submit_assessed_document(uuid, uuid, uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.submit_assessed_document(p_assessment_id uuid, p_user_id uuid, p_patient_id uuid, p_file_path text, p_extracted_metadata jsonb, OUT document_id uuid, OUT created boolean) RETURNS record
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_pending public.pending_document_ocr;
  v_path_prefix text;
  v_extension text;
begin
  if p_assessment_id is null or p_user_id is null or p_patient_id is null then
    raise exception 'missing argument' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.patients p
    where p.id = p_patient_id
      and p.profile_id = p_user_id
  ) then
    raise exception 'patient does not belong to user' using errcode = '42501';
  end if;

  v_path_prefix := p_user_id::text || '/' || p_assessment_id::text || '.';
  v_extension := substr(coalesce(p_file_path, ''), char_length(v_path_prefix) + 1);
  if left(coalesce(p_file_path, ''), char_length(v_path_prefix)) <> v_path_prefix
     or v_extension = ''
     or strpos(v_extension, '/') > 0 then
    raise exception 'invalid file path' using errcode = '22023';
  end if;

  delete from public.pending_document_ocr o
   where o.id = p_assessment_id
     and o.user_id = p_user_id
     and o.patient_id = p_patient_id
  returning * into v_pending;

  if not found then
    -- Already consumed: by a concurrent call that committed while this one
    -- waited on the row lock, or by an earlier call whose response was lost.
    select d.id into document_id
      from public.documents d
     where d.source_assessment_id = p_assessment_id
       and d.uploader_id = p_user_id;

    if found then
      created := false;
      return;
    end if;

    raise exception 'document assessment not found' using errcode = 'P0002';
  end if;

  begin
    insert into public.documents
      (patient_id, uploader_id, file_name, file_path, file_type, status, ocr_text, extracted_metadata, source_assessment_id)
    values (
      v_pending.patient_id,
      p_user_id,
      v_pending.file_name,
      p_file_path,
      v_pending.file_type,
      'pending',
      case when v_pending.ocr_text ~ '\S' then v_pending.ocr_text end,
      p_extracted_metadata,
      p_assessment_id
    )
    returning id into document_id;
  exception when unique_violation then
    -- A pending row re-inserted under an id that was already consumed. The
    -- delete above stands; report the document that already exists.
    select d.id into document_id
      from public.documents d
     where d.source_assessment_id = p_assessment_id
       and d.uploader_id = p_user_id;

    if not found then
      raise;
    end if;

    created := false;
    return;
  end;

  created := true;
end;
$$;


--
-- Name: sync_email_verified_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_email_verified_at() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  update public.profiles
     set email_verified_at = new.email_confirmed_at
   where id = new.id
     and email_verified_at is null;
  return new;
end;
$$;


--
-- Name: sync_profile_legacy_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_profile_legacy_role() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_role public.roles;
begin
  if new.role_id is null then
    return new;
  end if;

  select * into v_role
  from public.roles r
  where r.id = new.role_id;

  -- A missing role id is the foreign key's problem, not this trigger's.
  if not found then
    return new;
  end if;

  if v_role.is_system then
    new.role := v_role.name;
  elsif v_role.base_role is not null then
    new.role := v_role.base_role;
  end if;

  return new;
end;
$$;


--
-- Name: sync_profiles_for_changed_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_profiles_for_changed_role() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  update public.profiles p
     set role_id = p.role_id
   where p.role_id = new.id;
  return null;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: patient_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patient_queue (
    id bigint NOT NULL,
    patient_id uuid NOT NULL,
    status text DEFAULT 'waiting'::text NOT NULL,
    department text NOT NULL,
    triage_notes text,
    priority_level text DEFAULT 'routine'::text NOT NULL,
    estimated_wait_minutes integer,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    queue_date date,
    queue_number integer,
    CONSTRAINT patient_queue_department_check CHECK ((department = ANY (ARRAY['laboratory'::text, 'imaging'::text, 'ultrasound'::text, 'ecg'::text]))),
    CONSTRAINT patient_queue_priority_level_check CHECK ((priority_level = ANY (ARRAY['routine'::text, 'urgent'::text, 'emergency'::text]))),
    CONSTRAINT patient_queue_queue_number_pair CHECK ((((queue_date IS NULL) = (queue_number IS NULL)) AND ((queue_number IS NULL) OR (queue_number > 0)))),
    CONSTRAINT patient_queue_status_check CHECK ((status = ANY (ARRAY['waiting'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text])))
);


--
-- Name: triage_patient(uuid, text, text, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.triage_patient(p_patient_id uuid, p_department text, p_priority_level text, p_vitals jsonb, p_notes text) RETURNS SETOF public.patient_queue
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_open_department text;
  v_date date;
  v_number integer;
  v_label text;
  v_constraint text;
  v_row public.patient_queue;
begin
  if not public.user_has_permission(auth.uid(), 'queue.manage') then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  select q.department into v_open_department
    from public.patient_queue q
   where q.patient_id = p_patient_id
     and q.status in ('waiting', 'in_progress')
   limit 1;

  if found then
    raise exception 'patient already has an open queue entry'
      using errcode = 'PT409', detail = v_open_department;
  end if;

  select a.allocated_date, a.allocated_number
    into v_date, v_number
    from public.allocate_queue_number(p_department) a;

  v_label := case p_department
               when 'laboratory' then 'LAB'
               when 'imaging' then 'IMG'
               when 'ultrasound' then 'ULT'
               when 'ecg' then 'ECG'
             end
             || '-' || lpad(v_number::text, greatest(3, length(v_number::text)), '0');

  begin
    insert into public.patient_queue
      (patient_id, department, status, priority_level, triage_notes, queue_date, queue_number)
    values (
      p_patient_id,
      p_department,
      'waiting',
      coalesce(p_priority_level, 'routine'),
      json_build_object('queue_number', v_label, 'vitals', p_vitals, 'notes', coalesce(p_notes, ''))::text,
      v_date,
      v_number
    )
    returning * into v_row;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint is distinct from 'patient_queue_one_open_per_patient' then
      raise;
    end if;

    -- A concurrent request opened an entry after the check above. It has
    -- committed by now (the index waited for it), so it is visible here.
    select q.department into v_open_department
      from public.patient_queue q
     where q.patient_id = p_patient_id
       and q.status in ('waiting', 'in_progress')
     limit 1;

    raise exception 'patient already has an open queue entry'
      using errcode = 'PT409', detail = coalesce(v_open_department, '');
  end;

  return next v_row;
end;
$$;


--
-- Name: trim_role_name(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trim_role_name(p_name text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select btrim(
    coalesce(p_name, ''),
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
  );
$$;


--
-- Name: update_custom_role(uuid, text, text, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_custom_role(p_role_id uuid, p_name text, p_description text, p_permission_ids uuid[]) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_name text;
  v_previous public.roles;
begin
  -- Permission is checked before the lock, so a caller without roles.manage
  -- cannot hold a lock on the row.
  if not public.user_has_permission(auth.uid(), 'roles.manage') then
    raise exception 'FORBIDDEN: Missing permission ''roles.manage''' using errcode = '42501';
  end if;

  -- Serialises concurrent edits of this role until commit.
  select * into v_previous
  from public.roles r
  where r.id = p_role_id
  for update;

  if not found then
    raise exception 'Select a valid role.' using errcode = 'P0002';
  end if;

  if v_previous.is_system then
    raise exception 'System roles cannot be edited.' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and pr.role_id = p_role_id
  ) then
    raise exception 'You cannot modify your own assigned role.' using errcode = '42501';
  end if;

  v_name := public.validate_custom_role_input(p_role_id, p_name, p_permission_ids);

  update public.roles r
     set name = v_name,
         description = p_description,
         updated_at = timezone('utc', now())
   where r.id = p_role_id;

  delete from public.role_permissions rp
  where rp.role_id = p_role_id;

  insert into public.role_permissions (role_id, permission_id)
  select p_role_id, x from unnest(p_permission_ids) x;

  return jsonb_build_object(
    'role_id', p_role_id,
    'previous_role_name', v_previous.name,
    'role_name', v_name,
    'previous_base_role', v_previous.base_role,
    'base_role', v_previous.base_role,
    'permission_count', cardinality(p_permission_ids)
  );
end;
$$;


--
-- Name: user_has_permission(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.user_has_permission(p_user_id uuid, p_permission_name text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_has_permission boolean;
begin
  if not public.auth_session_satisfies_mfa() then
    return false;
  end if;

  -- Callers (policies, the app, archive_specialist_patient) only ever ask about
  -- the session user; only service_role may ask about someone else.
  if p_user_id is distinct from auth.uid()
     and coalesce(auth.role(), '') <> 'service_role' then
    return false;
  end if;

  select exists (
    select 1
    from public.profiles pr
    join public.role_permissions rp on pr.role_id = rp.role_id
    join public.permissions pe on rp.permission_id = pe.id
    where pr.id = p_user_id and pr.is_active and pe.name = p_permission_name
  ) into v_has_permission;

  return coalesce(v_has_permission, false);
end;
$$;


--
-- Name: validate_custom_role_input(uuid, text, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_custom_role_input(p_role_id uuid, p_name text, p_permission_ids uuid[]) RETURNS text
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  v_name text := public.trim_role_name(p_name);
  v_known integer;
begin
  if not public.user_has_permission(auth.uid(), 'roles.manage') then
    raise exception 'FORBIDDEN: Missing permission ''roles.manage''' using errcode = '42501';
  end if;

  if char_length(v_name) < 3 then
    raise exception 'Role name must be at least 3 characters.' using errcode = '22023';
  end if;

  if char_length(v_name) > 50 then
    raise exception 'Role name must be 50 characters or fewer.' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.roles r
    where lower(public.trim_role_name(r.name)) = lower(v_name)
      and r.id is distinct from p_role_id
  ) then
    raise exception 'A role with this name already exists.' using errcode = '23505';
  end if;

  if p_permission_ids is null or array_position(p_permission_ids, null) is not null then
    raise exception 'One or more selected permissions do not exist.' using errcode = '22023';
  end if;

  if cardinality(p_permission_ids) <> (select count(distinct x) from unnest(p_permission_ids) x) then
    raise exception 'Each permission can only be selected once.' using errcode = '22023';
  end if;

  select count(*) into v_known
  from public.permissions pe
  where pe.id = any (p_permission_ids);

  if v_known <> cardinality(p_permission_ids) then
    raise exception 'One or more selected permissions do not exist.' using errcode = '22023';
  end if;

  return v_name;
end;
$$;


--
-- Name: chatbot_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chatbot_logs (
    id bigint NOT NULL,
    user_id uuid,
    session_id text NOT NULL,
    user_message text NOT NULL,
    bot_response text NOT NULL,
    tokens_used integer DEFAULT 0 NOT NULL,
    feedback text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT chatbot_logs_feedback_check CHECK ((feedback = ANY (ARRAY['helpful'::text, 'unhelpful'::text])))
);


--
-- Name: chatbot_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.chatbot_logs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.chatbot_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: department_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.department_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    patient_id uuid NOT NULL,
    recorder_id uuid NOT NULL,
    department text NOT NULL,
    test_type text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    test_name text NOT NULL,
    test_value text NOT NULL,
    unit text,
    reference_range_min numeric,
    reference_range_max numeric,
    is_flagged boolean DEFAULT false NOT NULL,
    CONSTRAINT department_records_department_check CHECK ((department = ANY (ARRAY['laboratory'::text, 'imaging'::text, 'ultrasound'::text, 'ecg'::text])))
);


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    patient_id uuid,
    uploader_id uuid NOT NULL,
    file_name text NOT NULL,
    file_path text NOT NULL,
    file_type text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    ocr_text text,
    extracted_metadata jsonb,
    rejection_reason text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    source_assessment_id uuid,
    CONSTRAINT documents_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: email_verification_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_verification_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    code text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: lab_plausibility_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lab_plausibility_limits (
    test_name text NOT NULL,
    plausible_min numeric NOT NULL,
    plausible_max numeric NOT NULL,
    unit text,
    CONSTRAINT lab_plausibility_limits_bounds CHECK ((plausible_min <= plausible_max))
);


--
-- Name: login_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.login_attempts (
    email_key text NOT NULL,
    ip text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    window_start timestamp with time zone DEFAULT now() NOT NULL,
    locked_until timestamp with time zone
);


--
-- Name: patient_queue_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.patient_queue ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.patient_queue_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: patients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid,
    first_name text NOT NULL,
    last_name text NOT NULL,
    date_of_birth date NOT NULL,
    gender text NOT NULL,
    contact_number text NOT NULL,
    email text,
    address text NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT patients_gender_check CHECK ((gender = ANY (ARRAY['male'::text, 'female'::text, 'other'::text])))
);


--
-- Name: pending_document_ocr; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_document_ocr (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    patient_id uuid NOT NULL,
    file_name text NOT NULL,
    file_type text NOT NULL,
    file_path text NOT NULL,
    ocr_text text DEFAULT ''::text NOT NULL,
    prompt_token_count integer,
    candidates_token_count integer,
    total_token_count integer,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    module text NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    full_name text NOT NULL,
    role text NOT NULL,
    department text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    accepted_privacy_at timestamp with time zone,
    email_verified_at timestamp with time zone,
    employee_type text,
    role_id uuid,
    CONSTRAINT profiles_department_check CHECK ((department = ANY (ARRAY['laboratory'::text, 'imaging'::text, 'ultrasound'::text, 'ecg'::text]))),
    CONSTRAINT profiles_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'receptionist'::text, 'department_staff'::text, 'medical_specialist'::text, 'patient'::text])))
);


--
-- Name: queue_number_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.queue_number_counters (
    department text NOT NULL,
    queue_date date NOT NULL,
    last_number integer NOT NULL,
    CONSTRAINT queue_number_counters_department_check CHECK ((department = ANY (ARRAY['laboratory'::text, 'imaging'::text, 'ultrasound'::text, 'ecg'::text]))),
    CONSTRAINT queue_number_counters_last_number_check CHECK ((last_number > 0))
);


--
-- Name: rag_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rag_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    embedding public.vector(768) NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permissions (
    role_id uuid NOT NULL,
    permission_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    is_system boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    base_role text,
    CONSTRAINT roles_base_role_check CHECK ((base_role = ANY (ARRAY['admin'::text, 'receptionist'::text, 'department_staff'::text, 'medical_specialist'::text, 'patient'::text]))),
    CONSTRAINT roles_name_length_check CHECK (((name = public.trim_role_name(name)) AND ((char_length(name) >= 3) AND (char_length(name) <= 50))))
);


--
-- Name: specialist_patients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.specialist_patients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    specialist_id uuid NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    date_of_birth date NOT NULL,
    gender text NOT NULL,
    contact_number text,
    email text,
    address text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT specialist_patients_gender_check CHECK ((gender = ANY (ARRAY['male'::text, 'female'::text, 'other'::text])))
);


--
-- Name: specialist_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.specialist_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    specialist_patient_id uuid NOT NULL,
    specialist_id uuid NOT NULL,
    test_type text NOT NULL,
    test_name text NOT NULL,
    test_value text NOT NULL,
    unit text,
    reference_range_min numeric,
    reference_range_max numeric,
    is_flagged boolean DEFAULT false NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: system_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_logs (
    id bigint NOT NULL,
    user_id uuid,
    event_type text NOT NULL,
    description text NOT NULL,
    ip_address text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: system_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.system_logs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.system_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: used_totp_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.used_totp_codes (
    factor_id uuid NOT NULL,
    code text NOT NULL,
    used_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: chatbot_logs chatbot_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chatbot_logs
    ADD CONSTRAINT chatbot_logs_pkey PRIMARY KEY (id);


--
-- Name: department_records department_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department_records
    ADD CONSTRAINT department_records_pkey PRIMARY KEY (id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: email_verification_codes email_verification_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verification_codes
    ADD CONSTRAINT email_verification_codes_pkey PRIMARY KEY (id);


--
-- Name: lab_plausibility_limits lab_plausibility_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lab_plausibility_limits
    ADD CONSTRAINT lab_plausibility_limits_pkey PRIMARY KEY (test_name);


--
-- Name: login_attempts login_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_attempts
    ADD CONSTRAINT login_attempts_pkey PRIMARY KEY (email_key, ip);


--
-- Name: patient_queue patient_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_queue
    ADD CONSTRAINT patient_queue_pkey PRIMARY KEY (id);


--
-- Name: patients patients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patients
    ADD CONSTRAINT patients_pkey PRIMARY KEY (id);


--
-- Name: pending_document_ocr pending_document_ocr_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_document_ocr
    ADD CONSTRAINT pending_document_ocr_pkey PRIMARY KEY (id);


--
-- Name: permissions permissions_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_name_key UNIQUE (name);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: queue_number_counters queue_number_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_number_counters
    ADD CONSTRAINT queue_number_counters_pkey PRIMARY KEY (department, queue_date);


--
-- Name: rag_documents rag_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rag_documents
    ADD CONSTRAINT rag_documents_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (role_id, permission_id);


--
-- Name: roles roles_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key UNIQUE (name);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: specialist_patients specialist_patients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.specialist_patients
    ADD CONSTRAINT specialist_patients_pkey PRIMARY KEY (id);


--
-- Name: specialist_records specialist_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.specialist_records
    ADD CONSTRAINT specialist_records_pkey PRIMARY KEY (id);


--
-- Name: system_logs system_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_logs
    ADD CONSTRAINT system_logs_pkey PRIMARY KEY (id);


--
-- Name: used_totp_codes used_totp_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.used_totp_codes
    ADD CONSTRAINT used_totp_codes_pkey PRIMARY KEY (factor_id, code);


--
-- Name: documents_source_assessment_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX documents_source_assessment_id_key ON public.documents USING btree (source_assessment_id) WHERE (source_assessment_id IS NOT NULL);


--
-- Name: idx_chatbot_logs_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chatbot_logs_session_id ON public.chatbot_logs USING btree (session_id);


--
-- Name: idx_documents_patient_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_patient_id ON public.documents USING btree (patient_id);


--
-- Name: idx_email_verification_codes_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_verification_codes_email ON public.email_verification_codes USING btree (email);


--
-- Name: idx_email_verification_codes_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_verification_codes_expires_at ON public.email_verification_codes USING btree (expires_at);


--
-- Name: idx_patient_queue_patient_id_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patient_queue_patient_id_created_at ON public.patient_queue USING btree (patient_id, created_at DESC);


--
-- Name: idx_pending_document_ocr_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pending_document_ocr_user_created ON public.pending_document_ocr USING btree (user_id, created_at);


--
-- Name: idx_system_logs_created_at_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_logs_created_at_desc ON public.system_logs USING btree (created_at DESC);


--
-- Name: login_attempts_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX login_attempts_window_start_idx ON public.login_attempts USING btree (window_start);


--
-- Name: patients_profile_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX patients_profile_id_key ON public.patients USING btree (profile_id);


--
-- Name: patient_queue_department_day_number_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX patient_queue_department_day_number_key ON public.patient_queue USING btree (department, queue_date, queue_number) WHERE (queue_number IS NOT NULL);


--
-- Name: patient_queue_one_open_per_patient; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX patient_queue_one_open_per_patient ON public.patient_queue USING btree (patient_id) WHERE (status = ANY (ARRAY['waiting'::text, 'in_progress'::text]));


--
-- Name: rag_documents_embedding_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rag_documents_embedding_idx ON public.rag_documents USING hnsw (embedding public.vector_cosine_ops);


--
-- Name: roles_name_folded_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX roles_name_folded_idx ON public.roles USING btree (lower(public.trim_role_name(name)));


--
-- Name: department_records department_records_lab_plausibility; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER department_records_lab_plausibility BEFORE INSERT OR UPDATE ON public.department_records FOR EACH ROW EXECUTE FUNCTION public.enforce_lab_plausibility();


--
-- Name: profiles profiles_sync_legacy_role; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profiles_sync_legacy_role BEFORE INSERT OR UPDATE OF role_id, role ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.sync_profile_legacy_role();


--
-- Name: roles roles_sync_profile_legacy_role; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER roles_sync_profile_legacy_role AFTER UPDATE OF name, is_system, base_role ON public.roles FOR EACH ROW WHEN (((old.name IS DISTINCT FROM new.name) OR (old.is_system IS DISTINCT FROM new.is_system) OR (old.base_role IS DISTINCT FROM new.base_role))) EXECUTE FUNCTION public.sync_profiles_for_changed_role();


--
-- Name: specialist_records specialist_records_lab_plausibility; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER specialist_records_lab_plausibility BEFORE INSERT OR UPDATE ON public.specialist_records FOR EACH ROW EXECUTE FUNCTION public.enforce_lab_plausibility();


--
-- Name: roles trg_prevent_system_role_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_system_role_deletion BEFORE DELETE ON public.roles FOR EACH ROW EXECUTE FUNCTION public.prevent_system_role_deletion();


--
-- Name: chatbot_logs chatbot_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chatbot_logs
    ADD CONSTRAINT chatbot_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: department_records department_records_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department_records
    ADD CONSTRAINT department_records_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;


--
-- Name: department_records department_records_recorder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department_records
    ADD CONSTRAINT department_records_recorder_id_fkey FOREIGN KEY (recorder_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: documents documents_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;


--
-- Name: documents documents_uploader_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_uploader_id_fkey FOREIGN KEY (uploader_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: patient_queue patient_queue_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_queue
    ADD CONSTRAINT patient_queue_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;


--
-- Name: patients patients_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patients
    ADD CONSTRAINT patients_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: pending_document_ocr pending_document_ocr_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_document_ocr
    ADD CONSTRAINT pending_document_ocr_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;


--
-- Name: pending_document_ocr pending_document_ocr_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_document_ocr
    ADD CONSTRAINT pending_document_ocr_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE SET NULL;


--
-- Name: role_permissions role_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: specialist_patients specialist_patients_specialist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.specialist_patients
    ADD CONSTRAINT specialist_patients_specialist_id_fkey FOREIGN KEY (specialist_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: specialist_records specialist_records_specialist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.specialist_records
    ADD CONSTRAINT specialist_records_specialist_id_fkey FOREIGN KEY (specialist_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: specialist_records specialist_records_specialist_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.specialist_records
    ADD CONSTRAINT specialist_records_specialist_patient_id_fkey FOREIGN KEY (specialist_patient_id) REFERENCES public.specialist_patients(id) ON DELETE CASCADE;


--
-- Name: system_logs system_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_logs
    ADD CONSTRAINT system_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: pending_document_ocr Admins can clean up pending OCR rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can clean up pending OCR rows" ON public.pending_document_ocr FOR DELETE USING (public.user_has_permission(auth.uid(), 'ocr_rows.manage.all'::text));


--
-- Name: rag_documents Admins can manage RAG documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage RAG documents" ON public.rag_documents USING (public.user_has_permission(auth.uid(), 'rag_documents.manage'::text)) WITH CHECK (public.user_has_permission(auth.uid(), 'rag_documents.manage'::text));


--
-- Name: chatbot_logs Admins can view chatbot logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view chatbot logs" ON public.chatbot_logs FOR SELECT USING (public.user_has_permission(auth.uid(), 'chatbot_logs.read'::text));


--
-- Name: system_logs Admins can view system logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view system logs" ON public.system_logs FOR SELECT USING (public.user_has_permission(auth.uid(), 'system_logs.read'::text));


--
-- Name: department_records Admins have full access to department records; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins have full access to department records" ON public.department_records USING (public.user_has_permission(auth.uid(), 'records.manage'::text)) WITH CHECK (public.user_has_permission(auth.uid(), 'records.manage'::text));


--
-- Name: documents Admins have full access to documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins have full access to documents" ON public.documents USING (public.user_has_permission(auth.uid(), 'documents.manage'::text)) WITH CHECK (public.user_has_permission(auth.uid(), 'documents.manage'::text));


--
-- Name: patients Admins have full access to patients; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins have full access to patients" ON public.patients USING (public.user_has_permission(auth.uid(), 'patients.manage'::text)) WITH CHECK (public.user_has_permission(auth.uid(), 'patients.manage'::text));


--
-- Name: profiles Admins have full access to profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins have full access to profiles" ON public.profiles USING (public.user_has_permission(auth.uid(), 'profiles.manage'::text)) WITH CHECK (public.user_has_permission(auth.uid(), 'profiles.manage'::text));


--
-- Name: patient_queue Admins have full access to queue; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins have full access to queue" ON public.patient_queue USING (public.user_has_permission(auth.uid(), 'queue.manage'::text)) WITH CHECK (public.user_has_permission(auth.uid(), 'queue.manage'::text));


--
-- Name: rag_documents Anyone can read RAG documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can read RAG documents" ON public.rag_documents FOR SELECT USING (true);


--
-- Name: POLICY "Anyone can read RAG documents" ON rag_documents; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON POLICY "Anyone can read RAG documents" ON public.rag_documents IS 'Deliberately public: the clinic-information corpus behind the patient chatbot. embedding is withheld by column privileges (migration_23), not by this policy.';


--
-- Name: lab_plausibility_limits Authenticated users can read lab plausibility limits; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can read lab plausibility limits" ON public.lab_plausibility_limits FOR SELECT TO authenticated USING (true);


--
-- Name: profiles Clinic staff can view all profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Clinic staff can view all profiles" ON public.profiles FOR SELECT USING (public.user_has_permission(auth.uid(), 'profiles.read_staff'::text));


--
-- Name: department_records Department staff can only view/insert/update within their own d; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Department staff can only view/insert/update within their own d" ON public.department_records USING ((public.user_has_permission(auth.uid(), 'records.manage.own_dept'::text) AND (department = public.get_auth_user_dept()))) WITH CHECK ((public.user_has_permission(auth.uid(), 'records.manage.own_dept'::text) AND (department = public.get_auth_user_dept())));


--
-- Name: patient_queue Department staff can view and update queue for their department; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Department staff can view and update queue for their department" ON public.patient_queue USING ((public.user_has_permission(auth.uid(), 'queue.manage.own_dept'::text) AND (department = public.get_auth_user_dept()))) WITH CHECK ((public.user_has_permission(auth.uid(), 'queue.manage.own_dept'::text) AND (department = public.get_auth_user_dept())));


--
-- Name: department_records Medical specialists can read all department records; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Medical specialists can read all department records" ON public.department_records FOR SELECT USING ((public.get_auth_user_role() = 'medical_specialist'::text));


--
-- Name: patient_queue Medical specialists can view queue; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Medical specialists can view queue" ON public.patient_queue FOR SELECT USING (public.user_has_permission(auth.uid(), 'queue.read'::text));


--
-- Name: pending_document_ocr Patients can delete own pending OCR rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Patients can delete own pending OCR rows" ON public.pending_document_ocr FOR DELETE USING (((public.get_auth_user_role() = 'patient'::text) AND (auth.uid() = user_id)));


--
-- Name: documents Patients can delete own pending documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Patients can delete own pending documents" ON public.documents FOR DELETE USING (((uploader_id = auth.uid()) AND (status = 'pending'::text)));


--
-- Name: patients Patients can insert own patient record; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Patients can insert own patient record" ON public.patients FOR INSERT WITH CHECK ((profile_id = auth.uid()));


--
-- Name: pending_document_ocr Patients can insert own pending OCR rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Patients can insert own pending OCR rows" ON public.pending_document_ocr FOR INSERT WITH CHECK (((public.get_auth_user_role() = 'patient'::text) AND (auth.uid() = user_id)));


--
-- Name: pending_document_ocr Patients can read own pending OCR rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Patients can read own pending OCR rows" ON public.pending_document_ocr FOR SELECT USING (((public.get_auth_user_role() = 'patient'::text) AND (auth.uid() = user_id)));


--
-- Name: patients Patients can update own details; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Patients can update own details" ON public.patients FOR UPDATE USING ((profile_id = auth.uid())) WITH CHECK ((profile_id = auth.uid()));


--
-- Name: department_records Patients can view only their own department records; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Patients can view only their own department records" ON public.department_records FOR SELECT USING ((patient_id IN ( SELECT patients.id
   FROM public.patients
  WHERE (patients.profile_id = auth.uid()))));


--
-- Name: documents Patients can view own documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Patients can view own documents" ON public.documents FOR SELECT USING (((uploader_id = auth.uid()) OR (patient_id IN ( SELECT patients.id
   FROM public.patients
  WHERE (patients.profile_id = auth.uid())))));


--
-- Name: patients Patients can view own patient record; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Patients can view own patient record" ON public.patients FOR SELECT USING ((profile_id = auth.uid()));


--
-- Name: patient_queue Patients can view own queue entries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Patients can view own queue entries" ON public.patient_queue FOR SELECT USING ((patient_id IN ( SELECT patients.id
   FROM public.patients
  WHERE (patients.profile_id = auth.uid()))));


--
-- Name: permissions Permitted staff can view permissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitted staff can view permissions" ON public.permissions FOR SELECT USING (public.user_has_permission(auth.uid(), 'roles.read'::text));


--
-- Name: role_permissions Permitted staff can view role_permissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitted staff can view role_permissions" ON public.role_permissions FOR SELECT USING (public.user_has_permission(auth.uid(), 'roles.read'::text));


--
-- Name: roles Permitted staff can view roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Permitted staff can view roles" ON public.roles FOR SELECT USING (public.user_has_permission(auth.uid(), 'roles.read'::text));


--
-- Name: patients Receptionists can manage patients; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Receptionists can manage patients" ON public.patients USING (public.user_has_permission(auth.uid(), 'patients.manage'::text)) WITH CHECK (public.user_has_permission(auth.uid(), 'patients.manage'::text));


--
-- Name: patient_queue Receptionists can manage queue; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Receptionists can manage queue" ON public.patient_queue USING (public.user_has_permission(auth.uid(), 'queue.manage'::text)) WITH CHECK (public.user_has_permission(auth.uid(), 'queue.manage'::text));


--
-- Name: documents Receptionists can view and update documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Receptionists can view and update documents" ON public.documents USING (public.user_has_permission(auth.uid(), 'documents.manage'::text)) WITH CHECK (public.user_has_permission(auth.uid(), 'documents.manage'::text));


--
-- Name: permissions Role managers have full access to permissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Role managers have full access to permissions" ON public.permissions USING (public.user_has_permission(auth.uid(), 'roles.manage'::text)) WITH CHECK (public.user_has_permission(auth.uid(), 'roles.manage'::text));


--
-- Name: role_permissions Role managers have full access to role_permissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Role managers have full access to role_permissions" ON public.role_permissions USING (public.user_has_permission(auth.uid(), 'roles.manage'::text)) WITH CHECK (public.user_has_permission(auth.uid(), 'roles.manage'::text));


--
-- Name: roles Role managers have full access to roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Role managers have full access to roles" ON public.roles USING (public.user_has_permission(auth.uid(), 'roles.manage'::text)) WITH CHECK (public.user_has_permission(auth.uid(), 'roles.manage'::text));


--
-- Name: specialist_patients Specialist creates own patients; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Specialist creates own patients" ON public.specialist_patients FOR INSERT TO authenticated WITH CHECK ((public.user_has_permission(auth.uid(), 'specialist.patients'::text) AND (specialist_id = auth.uid()) AND (deleted_at IS NULL)));


--
-- Name: specialist_records Specialist creates own records; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Specialist creates own records" ON public.specialist_records FOR INSERT TO authenticated WITH CHECK ((public.user_has_permission(auth.uid(), 'specialist.records'::text) AND (specialist_id = auth.uid()) AND (deleted_at IS NULL)));


--
-- Name: specialist_patients Specialist reads own active patients; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Specialist reads own active patients" ON public.specialist_patients FOR SELECT TO authenticated USING ((public.user_has_permission(auth.uid(), 'specialist.patients'::text) AND (specialist_id = auth.uid()) AND (deleted_at IS NULL)));


--
-- Name: specialist_records Specialist reads own active records; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Specialist reads own active records" ON public.specialist_records FOR SELECT TO authenticated USING ((public.user_has_permission(auth.uid(), 'specialist.records'::text) AND (specialist_id = auth.uid()) AND (deleted_at IS NULL)));


--
-- Name: specialist_patients Specialist updates own patients; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Specialist updates own patients" ON public.specialist_patients FOR UPDATE TO authenticated USING ((public.user_has_permission(auth.uid(), 'specialist.patients'::text) AND (specialist_id = auth.uid()))) WITH CHECK ((public.user_has_permission(auth.uid(), 'specialist.patients'::text) AND (specialist_id = auth.uid())));


--
-- Name: specialist_records Specialist updates own records; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Specialist updates own records" ON public.specialist_records FOR UPDATE TO authenticated USING ((public.user_has_permission(auth.uid(), 'specialist.records'::text) AND (specialist_id = auth.uid()))) WITH CHECK ((public.user_has_permission(auth.uid(), 'specialist.records'::text) AND (specialist_id = auth.uid())));


--
-- Name: patients Staff and specialists can view all patients; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff and specialists can view all patients" ON public.patients FOR SELECT USING ((public.get_auth_user_role() = ANY (ARRAY['department_staff'::text, 'medical_specialist'::text])));


--
-- Name: patients Staff can view all patients; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can view all patients" ON public.patients FOR SELECT USING (public.user_has_permission(auth.uid(), 'patients.read'::text));


--
-- Name: profiles Users can read own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own profile" ON public.profiles FOR SELECT USING ((auth.uid() = id));


--
-- Name: profiles Users can update own profile details; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own profile details" ON public.profiles FOR UPDATE TO authenticated USING (((auth.uid() = id) AND (is_active IS TRUE))) WITH CHECK (((auth.uid() = id) AND (NOT (role IS DISTINCT FROM ( SELECT p.role
   FROM public.profiles p
  WHERE (p.id = auth.uid())))) AND (NOT (role_id IS DISTINCT FROM ( SELECT p.role_id
   FROM public.profiles p
  WHERE (p.id = auth.uid())))) AND (NOT (department IS DISTINCT FROM ( SELECT p.department
   FROM public.profiles p
  WHERE (p.id = auth.uid())))) AND (NOT (is_active IS DISTINCT FROM ( SELECT p.is_active
   FROM public.profiles p
  WHERE (p.id = auth.uid())))) AND (NOT (email_verified_at IS DISTINCT FROM ( SELECT p.email_verified_at
   FROM public.profiles p
  WHERE (p.id = auth.uid()))))));


--
-- Name: chatbot_logs Users can view and insert own chatbot logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view and insert own chatbot logs" ON public.chatbot_logs USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: profiles Users with profiles.manage can update any profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users with profiles.manage can update any profile" ON public.profiles FOR UPDATE TO authenticated USING (public.user_has_permission(auth.uid(), 'profiles.manage'::text)) WITH CHECK (public.user_has_permission(auth.uid(), 'profiles.manage'::text));


--
-- Name: chatbot_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chatbot_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: department_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.department_records ENABLE ROW LEVEL SECURITY;

--
-- Name: documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

--
-- Name: email_verification_codes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_verification_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: lab_plausibility_limits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lab_plausibility_limits ENABLE ROW LEVEL SECURITY;

--
-- Name: login_attempts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

--
-- Name: patient_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.patient_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: patients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;

--
-- Name: pending_document_ocr; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pending_document_ocr ENABLE ROW LEVEL SECURITY;

--
-- Name: permissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: queue_number_counters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.queue_number_counters ENABLE ROW LEVEL SECURITY;

--
-- Name: rag_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rag_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: role_permissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

--
-- Name: specialist_patients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.specialist_patients ENABLE ROW LEVEL SECURITY;

--
-- Name: specialist_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.specialist_records ENABLE ROW LEVEL SECURITY;

--
-- Name: system_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: used_totp_codes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.used_totp_codes ENABLE ROW LEVEL SECURITY;

-- Clear Supabase default object grants before restoring the captured ACLs.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated, service_role;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION allocate_queue_number(p_department text, OUT allocated_date date, OUT allocated_number integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.allocate_queue_number(p_department text, OUT allocated_date date, OUT allocated_number integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.allocate_queue_number(p_department text, OUT allocated_date date, OUT allocated_number integer) TO authenticated;
GRANT ALL ON FUNCTION public.allocate_queue_number(p_department text, OUT allocated_date date, OUT allocated_number integer) TO service_role;


--
-- Name: FUNCTION archive_specialist_patient(p_patient_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.archive_specialist_patient(p_patient_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.archive_specialist_patient(p_patient_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.archive_specialist_patient(p_patient_id uuid) TO service_role;


--
-- Name: FUNCTION auth_session_satisfies_mfa(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.auth_session_satisfies_mfa() TO anon;
GRANT ALL ON FUNCTION public.auth_session_satisfies_mfa() TO authenticated;
GRANT ALL ON FUNCTION public.auth_session_satisfies_mfa() TO service_role;


--
-- Name: FUNCTION begin_login_attempt(p_email text, p_ip text, OUT allowed boolean, OUT retry_after timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.begin_login_attempt(p_email text, p_ip text, OUT allowed boolean, OUT retry_after timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.begin_login_attempt(p_email text, p_ip text, OUT allowed boolean, OUT retry_after timestamp with time zone) TO service_role;


--
-- Name: FUNCTION claim_totp_code(p_factor_id uuid, p_code text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_totp_code(p_factor_id uuid, p_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_totp_code(p_factor_id uuid, p_code text) TO service_role;


--
-- Name: FUNCTION cleanup_expired_verification_codes(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cleanup_expired_verification_codes() FROM PUBLIC;
GRANT ALL ON FUNCTION public.cleanup_expired_verification_codes() TO service_role;


--
-- Name: FUNCTION clear_login_attempts(p_email text, p_ip text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.clear_login_attempts(p_email text, p_ip text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.clear_login_attempts(p_email text, p_ip text) TO service_role;


--
-- Name: FUNCTION create_custom_role(p_name text, p_description text, p_permission_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_custom_role(p_name text, p_description text, p_permission_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_custom_role(p_name text, p_description text, p_permission_ids uuid[]) TO authenticated;


--
-- Name: FUNCTION enforce_lab_plausibility(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enforce_lab_plausibility() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enforce_lab_plausibility() TO service_role;


--
-- Name: FUNCTION get_auth_user_dept(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_auth_user_dept() TO anon;
GRANT ALL ON FUNCTION public.get_auth_user_dept() TO authenticated;
GRANT ALL ON FUNCTION public.get_auth_user_dept() TO service_role;


--
-- Name: FUNCTION get_auth_user_role(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_auth_user_role() TO anon;
GRANT ALL ON FUNCTION public.get_auth_user_role() TO authenticated;
GRANT ALL ON FUNCTION public.get_auth_user_role() TO service_role;


--
-- Name: FUNCTION get_daily_token_usage(start_date timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_daily_token_usage(start_date timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_daily_token_usage(start_date timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.get_daily_token_usage(start_date timestamp with time zone) TO service_role;


--
-- Name: FUNCTION get_role_for_email(email_address text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_role_for_email(email_address text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_role_for_email(email_address text) TO service_role;


--
-- Name: FUNCTION get_user_id_by_email(email_address text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_user_id_by_email(email_address text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_user_id_by_email(email_address text) TO service_role;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.handle_new_user() TO anon;
GRANT ALL ON FUNCTION public.handle_new_user() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;


--
-- Name: FUNCTION match_documents(query_embedding public.vector, match_threshold double precision, match_count integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.match_documents(query_embedding public.vector, match_threshold double precision, match_count integer) TO anon;
GRANT ALL ON FUNCTION public.match_documents(query_embedding public.vector, match_threshold double precision, match_count integer) TO authenticated;
GRANT ALL ON FUNCTION public.match_documents(query_embedding public.vector, match_threshold double precision, match_count integer) TO service_role;


--
-- Name: FUNCTION prevent_system_role_deletion(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.prevent_system_role_deletion() TO anon;
GRANT ALL ON FUNCTION public.prevent_system_role_deletion() TO authenticated;
GRANT ALL ON FUNCTION public.prevent_system_role_deletion() TO service_role;


--
-- Name: FUNCTION refund_login_attempt(p_email text, p_ip text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.refund_login_attempt(p_email text, p_ip text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.refund_login_attempt(p_email text, p_ip text) TO service_role;


--
-- Name: FUNCTION submit_assessed_document(p_assessment_id uuid, p_user_id uuid, p_patient_id uuid, p_file_path text, p_extracted_metadata jsonb, OUT document_id uuid, OUT created boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.submit_assessed_document(p_assessment_id uuid, p_user_id uuid, p_patient_id uuid, p_file_path text, p_extracted_metadata jsonb, OUT document_id uuid, OUT created boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.submit_assessed_document(p_assessment_id uuid, p_user_id uuid, p_patient_id uuid, p_file_path text, p_extracted_metadata jsonb, OUT document_id uuid, OUT created boolean) TO service_role;


--
-- Name: FUNCTION sync_email_verified_at(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sync_email_verified_at() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_email_verified_at() TO service_role;


--
-- Name: FUNCTION sync_profile_legacy_role(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sync_profile_legacy_role() TO anon;
GRANT ALL ON FUNCTION public.sync_profile_legacy_role() TO authenticated;
GRANT ALL ON FUNCTION public.sync_profile_legacy_role() TO service_role;


--
-- Name: FUNCTION sync_profiles_for_changed_role(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sync_profiles_for_changed_role() TO anon;
GRANT ALL ON FUNCTION public.sync_profiles_for_changed_role() TO authenticated;
GRANT ALL ON FUNCTION public.sync_profiles_for_changed_role() TO service_role;


--
-- Name: TABLE patient_queue; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.patient_queue TO anon;
GRANT ALL ON TABLE public.patient_queue TO authenticated;
GRANT ALL ON TABLE public.patient_queue TO service_role;


--
-- Name: FUNCTION triage_patient(p_patient_id uuid, p_department text, p_priority_level text, p_vitals jsonb, p_notes text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.triage_patient(p_patient_id uuid, p_department text, p_priority_level text, p_vitals jsonb, p_notes text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.triage_patient(p_patient_id uuid, p_department text, p_priority_level text, p_vitals jsonb, p_notes text) TO authenticated;
GRANT ALL ON FUNCTION public.triage_patient(p_patient_id uuid, p_department text, p_priority_level text, p_vitals jsonb, p_notes text) TO service_role;


--
-- Name: FUNCTION trim_role_name(p_name text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.trim_role_name(p_name text) TO anon;
GRANT ALL ON FUNCTION public.trim_role_name(p_name text) TO authenticated;
GRANT ALL ON FUNCTION public.trim_role_name(p_name text) TO service_role;


--
-- Name: FUNCTION update_custom_role(p_role_id uuid, p_name text, p_description text, p_permission_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_custom_role(p_role_id uuid, p_name text, p_description text, p_permission_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_custom_role(p_role_id uuid, p_name text, p_description text, p_permission_ids uuid[]) TO authenticated;


--
-- Name: FUNCTION user_has_permission(p_user_id uuid, p_permission_name text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.user_has_permission(p_user_id uuid, p_permission_name text) TO authenticated;
GRANT ALL ON FUNCTION public.user_has_permission(p_user_id uuid, p_permission_name text) TO service_role;


--
-- Name: FUNCTION validate_custom_role_input(p_role_id uuid, p_name text, p_permission_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.validate_custom_role_input(p_role_id uuid, p_name text, p_permission_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.validate_custom_role_input(p_role_id uuid, p_name text, p_permission_ids uuid[]) TO authenticated;


--
-- Name: TABLE chatbot_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.chatbot_logs TO anon;
GRANT ALL ON TABLE public.chatbot_logs TO authenticated;
GRANT ALL ON TABLE public.chatbot_logs TO service_role;


--
-- Name: SEQUENCE chatbot_logs_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.chatbot_logs_id_seq TO anon;
GRANT ALL ON SEQUENCE public.chatbot_logs_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.chatbot_logs_id_seq TO service_role;


--
-- Name: TABLE department_records; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.department_records TO anon;
GRANT ALL ON TABLE public.department_records TO authenticated;
GRANT ALL ON TABLE public.department_records TO service_role;


--
-- Name: TABLE documents; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.documents TO anon;
GRANT ALL ON TABLE public.documents TO authenticated;
GRANT ALL ON TABLE public.documents TO service_role;


--
-- Name: TABLE email_verification_codes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.email_verification_codes TO anon;
GRANT ALL ON TABLE public.email_verification_codes TO authenticated;
GRANT ALL ON TABLE public.email_verification_codes TO service_role;


--
-- Name: TABLE lab_plausibility_limits; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.lab_plausibility_limits TO service_role;
GRANT SELECT ON TABLE public.lab_plausibility_limits TO authenticated;


--
-- Name: TABLE login_attempts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.login_attempts TO service_role;


--
-- Name: SEQUENCE patient_queue_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.patient_queue_id_seq TO anon;
GRANT ALL ON SEQUENCE public.patient_queue_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.patient_queue_id_seq TO service_role;


--
-- Name: TABLE patients; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.patients TO anon;
GRANT ALL ON TABLE public.patients TO authenticated;
GRANT ALL ON TABLE public.patients TO service_role;


--
-- Name: TABLE pending_document_ocr; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.pending_document_ocr TO anon;
GRANT ALL ON TABLE public.pending_document_ocr TO authenticated;
GRANT ALL ON TABLE public.pending_document_ocr TO service_role;


--
-- Name: TABLE permissions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.permissions TO anon;
GRANT ALL ON TABLE public.permissions TO authenticated;
GRANT ALL ON TABLE public.permissions TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: TABLE queue_number_counters; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.queue_number_counters TO service_role;


--
-- Name: TABLE rag_documents; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.rag_documents TO anon;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.rag_documents TO authenticated;
GRANT ALL ON TABLE public.rag_documents TO service_role;


--
-- Name: COLUMN rag_documents.id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(id) ON TABLE public.rag_documents TO anon;
GRANT SELECT(id) ON TABLE public.rag_documents TO authenticated;


--
-- Name: COLUMN rag_documents.title; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(title) ON TABLE public.rag_documents TO anon;
GRANT SELECT(title) ON TABLE public.rag_documents TO authenticated;


--
-- Name: COLUMN rag_documents.content; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(content) ON TABLE public.rag_documents TO anon;
GRANT SELECT(content) ON TABLE public.rag_documents TO authenticated;


--
-- Name: COLUMN rag_documents.metadata; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(metadata) ON TABLE public.rag_documents TO anon;
GRANT SELECT(metadata) ON TABLE public.rag_documents TO authenticated;


--
-- Name: COLUMN rag_documents.created_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(created_at) ON TABLE public.rag_documents TO anon;
GRANT SELECT(created_at) ON TABLE public.rag_documents TO authenticated;


--
-- Name: TABLE role_permissions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.role_permissions TO anon;
GRANT ALL ON TABLE public.role_permissions TO authenticated;
GRANT ALL ON TABLE public.role_permissions TO service_role;


--
-- Name: TABLE roles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.roles TO anon;
GRANT ALL ON TABLE public.roles TO authenticated;
GRANT ALL ON TABLE public.roles TO service_role;


--
-- Name: TABLE specialist_patients; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.specialist_patients TO anon;
GRANT ALL ON TABLE public.specialist_patients TO authenticated;
GRANT ALL ON TABLE public.specialist_patients TO service_role;


--
-- Name: TABLE specialist_records; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.specialist_records TO anon;
GRANT ALL ON TABLE public.specialist_records TO authenticated;
GRANT ALL ON TABLE public.specialist_records TO service_role;


--
-- Name: TABLE system_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.system_logs TO anon;
GRANT ALL ON TABLE public.system_logs TO authenticated;
GRANT ALL ON TABLE public.system_logs TO service_role;


--
-- Name: SEQUENCE system_logs_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.system_logs_id_seq TO anon;
GRANT ALL ON SEQUENCE public.system_logs_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.system_logs_id_seq TO service_role;


--
-- Name: TABLE used_totp_codes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.used_totp_codes TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- PostgreSQL database dump complete
--



-- System reference data only. IDs and timestamps use fresh database defaults.
INSERT INTO public.permissions (name, description, module) VALUES
  ('staff.manage', 'Create, update, and manage clinic personnel credentials and roles', 'staff'),
  ('profiles.manage', 'Full access to create, read, update, delete user profiles', 'profiles'),
  ('profiles.read_staff', 'View clinical and receptionist profiles', 'profiles'),
  ('patients.manage', 'Register and manage patients', 'patients'),
  ('patients.read', 'Search and view patient directory records', 'patients'),
  ('queue.manage', 'Route and update clinic department triage queues', 'queue'),
  ('queue.manage.own_dept', 'Manage triage queue for own department', 'queue'),
  ('queue.read', 'View active clinic triage queues', 'queue'),
  ('documents.manage', 'Approve, reject, and route patient documents', 'documents'),
  ('records.manage', 'Manage medical and diagnostic records', 'records'),
  ('records.manage.own_dept', 'Manage diagnostic records for own department', 'records'),
  ('system_logs.read', 'View audit logs', 'audit'),
  ('chatbot_logs.read', 'View chatbot conversations', 'audit'),
  ('rag_documents.manage', 'Update and configure RAG knowledge files', 'knowledge'),
  ('storage.patient_documents.read', 'Select access to patient-documents storage bucket objects', 'storage'),
  ('specialist.patients', 'Manage specialist patient list', 'specialist'),
  ('specialist.analytics', 'Access specialist analytic graphs', 'specialist'),
  ('specialist.records', 'Access specialist private record entry', 'specialist'),
  ('chat.access', 'Access the AI medical assistant chat console', 'patient'),
  ('ocr_rows.manage.own', 'Insert, read, or delete own pending OCR uploads', 'patient'),
  ('ocr_rows.manage.all', 'Clean up or manage any pending OCR upload rows', 'admin'),
  ('roles.manage', 'Create, update, and manage role permission mappings', 'roles'),
  ('roles.read', 'View roles and permission catalog', 'roles');
INSERT INTO public.roles (name, description, is_system) VALUES
  ('admin', 'Administrator role with full clinic systems access', true),
  ('receptionist', 'Receptionist role for registration and document intake', true),
  ('department_staff', 'Clinical staff assigned to lab/imaging/ECG/ultrasound departments', true),
  ('medical_specialist', 'Doctors and specialists managing private patient cohorts', true),
  ('patient', 'Patient role for self-service actions', true);
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM (VALUES
  ('admin', 'staff.manage'),
  ('admin', 'profiles.manage'),
  ('admin', 'profiles.read_staff'),
  ('admin', 'patients.manage'),
  ('admin', 'queue.manage'),
  ('admin', 'documents.manage'),
  ('admin', 'records.manage'),
  ('admin', 'system_logs.read'),
  ('admin', 'chatbot_logs.read'),
  ('admin', 'rag_documents.manage'),
  ('admin', 'storage.patient_documents.read'),
  ('admin', 'chat.access'),
  ('admin', 'ocr_rows.manage.all'),
  ('receptionist', 'profiles.read_staff'),
  ('receptionist', 'patients.manage'),
  ('receptionist', 'queue.manage'),
  ('receptionist', 'documents.manage'),
  ('receptionist', 'storage.patient_documents.read'),
  ('department_staff', 'profiles.read_staff'),
  ('department_staff', 'patients.read'),
  ('department_staff', 'queue.manage.own_dept'),
  ('department_staff', 'records.manage.own_dept'),
  ('medical_specialist', 'profiles.read_staff'),
  ('medical_specialist', 'queue.read'),
  ('medical_specialist', 'specialist.patients'),
  ('medical_specialist', 'specialist.analytics'),
  ('medical_specialist', 'specialist.records'),
  ('patient', 'chat.access'),
  ('patient', 'ocr_rows.manage.own'),
  ('admin', 'roles.manage'),
  ('admin', 'roles.read'),
  ('receptionist', 'roles.read'),
  ('department_staff', 'roles.read'),
  ('medical_specialist', 'roles.read')
) AS seed(role_name, permission_name)
JOIN public.roles r ON r.name = seed.role_name
JOIN public.permissions p ON p.name = seed.permission_name;

-- Supabase-managed schemas: create only the app's bucket, policies and triggers.
insert into storage.buckets (id, name, public)
values ('patient-documents', 'patient-documents', false)
on conflict (id) do nothing;

-- 2. Enable RLS on storage.objects (Supabase enables this by default, owner only)
-- alter table storage.objects enable row level security;

-- 3. Storage Policies

-- Drop existing policies on patient-documents to avoid conflict
drop policy if exists "Allow patient upload own files" on storage.objects;
drop policy if exists "Allow patient read own files" on storage.objects;
drop policy if exists "Allow staff and admin read all patient files" on storage.objects;
drop policy if exists "Allow patient delete own pending files" on storage.objects;

-- Patients upload only their pending submissions: <uid>/pending-submissions/... (migration_36).
-- Final files are written by the server with the service role.
create policy "Allow patient upload own files"
  on storage.objects for insert
  with check (
    bucket_id = 'patient-documents' AND
    (storage.foldername(name))[1] = auth.uid()::text AND
    (storage.foldername(name))[2] = 'pending-submissions'
  );

-- Allow authenticated patients to read files only under their own directory prefix
create policy "Allow patient read own files"
  on storage.objects for select
  using (
    bucket_id = 'patient-documents' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

-- Allow clinic staff and admins to read all patient document files
create policy "Allow staff and admin read all patient files"
  on storage.objects for select
  using (
    bucket_id = 'patient-documents' AND
    public.user_has_permission(auth.uid(), 'storage.patient_documents.read')
  );

-- Allow authenticated patients to delete their own pending uploads (migration_36)
create policy "Allow patient delete own pending files"
  on storage.objects for delete
  using (
    bucket_id = 'patient-documents' AND
    (storage.foldername(name))[1] = auth.uid()::text AND
    (storage.foldername(name))[2] = 'pending-submissions'
  );

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
CREATE TRIGGER on_auth_user_email_confirmed
AFTER UPDATE OF email_confirmed_at ON auth.users
FOR EACH ROW WHEN (old.email_confirmed_at IS NULL AND new.email_confirmed_at IS NOT NULL)
EXECUTE FUNCTION public.sync_email_verified_at();

-- Supabase normally creates this publication, but empty local projects may not.
DO $publication$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END;
$publication$;
ALTER PUBLICATION supabase_realtime ADD TABLE public.documents, public.patient_queue;

-- Snapshot coverage, not evidence of individually replayed historical migrations.
-- 07-26 had no tracked versions: the snapshot assigns 202610170000NN markers.
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version text PRIMARY KEY,
  statements text[],
  name text
);
INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
  ('20260701000000', 'add_email_verification'),
  ('20260705000000', 'add_get_role_for_email'),
  ('20261017000007', 'legacy_7'),
  ('20261017000008', 'legacy_8'),
  ('20261017000009', 'legacy_9'),
  ('20261017000010', 'legacy_10'),
  ('20261017000011', 'legacy_11'),
  ('20261017000012', 'legacy_12'),
  ('20261017000013', 'legacy_13'),
  ('20261017000014', 'legacy_14'),
  ('20261017000015', 'legacy_15'),
  ('20261017000016', 'legacy_16'),
  ('20261017000017', 'legacy_17'),
  ('20261017000018', 'legacy_18'),
  ('20261017000019', 'legacy_19'),
  ('20261017000020', 'legacy_20'),
  ('20261017000021', 'legacy_21'),
  ('20261017000022', 'legacy_22'),
  ('20261017000023', 'legacy_23'),
  ('20261017000024', 'legacy_24'),
  ('20261017000025', 'legacy_25'),
  ('20261017000026', 'legacy_26'),
  ('20261017000027', 'legacy_27'),
  ('20261017000028', 'legacy_28'),
  ('20261017000029', 'legacy_29'),
  ('20261018000030', 'legacy_30'),
  ('20261018000031', 'legacy_31'),
  ('20261018000032', 'legacy_32'),
  ('20261018000033', 'legacy_33'),
  ('20261018000034', 'legacy_34'),
  ('20261018000035', 'legacy_35'),
  ('20261018000036', 'legacy_36'),
  ('20261020000037', 'legacy_37'),
  ('20261021000038', 'legacy_38'),
  ('20261022000039', 'legacy_39'),
  ('20261023000040', 'legacy_40')
ON CONFLICT (version) DO NOTHING;

COMMIT;
