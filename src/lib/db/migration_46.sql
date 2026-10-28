-- KlinikAid Migration 46: trigram index + gated search function for system log descriptions
--
-- Why: "admin: system logs: search descriptions" is the one System Logs action
-- that stayed over budget after #234 and #235 (3489 ms baseline against a
-- 500 ms budget). The search filters system_logs with
-- description ILIKE '%term%' (readSystemLogPage -> filteredSystemLogQuery),
-- and '%…%' cannot use a btree index, so Postgres reads the whole table once
-- for the page and once for the exact count that a new search always runs.
-- The table has about 7,500 rows today and only grows.
--
-- What this adds:
--
--   idx_system_logs_description_trgm
--     A pg_trgm GIN index over public.system_logs (description), with the
--     operator class schema-qualified (extensions.gin_trgm_ops) so the
--     statement does not depend on the session's search_path. pg_trgm is
--     installed in the `extensions` schema (Supabase convention); the live
--     project did not have it yet (2026-10-27).
--
--   search_system_logs(text, uuid, timestamptz, timestamptz, text, integer, integer)
--     Returns { total, logs } for one page of the same filters the API sends.
--     Needed because of a planner rule, verified in a throwaway Postgres
--     (17.6, same as production) seeded with 200k rows:
--
--     * As the table owner (RLS bypassed), the planner serves
--       `description ILIKE '%…%'` from this index as a bitmap index scan:
--       316 ms -> 16.5 ms for the count, 324 ms -> 16.5 ms for the page.
--     * As `authenticated` under the "Admins can view system logs" policy,
--       the planner never uses it, for any term: ILIKE (texticlike) is not
--       LEAKPROOF, and Postgres refuses to push a non-leakproof predicate
--       below a table's security quals into an index condition. Only
--       bypassing roles (owner, BYPASSRLS) get the index. Marking the
--       operator leakproof needs a superuser, which hosted Supabase's
--       `postgres` role is not.
--
--     The function runs as its owner (SECURITY DEFINER), which bypasses RLS
--     for the rows it reads, so the query inside has no security quals and
--     the planner can pick the bitmap scan. Access stays identical:
--       - It refuses callers without system_logs.read with 42501, using the
--         same public.user_has_permission call (same is_active and MFA
--         rules) the RLS policy uses. That policy is a table-level gate:
--         every holder of system_logs.read may read every row, so the
--         function returns exactly the rows the policy would allow.
--       - The profiles a log row embeds keep their own visibility: the join
--         inlines the three SELECT policies of public.profiles
--         (profiles.read_staff, profiles.manage, or the caller's own row),
--         so a profile the caller could not read through PostgREST still
--         comes back as null.
--     This is the same shape as dashboard_access_context (migration 44) and
--     list_staff_registry (migration 45): SECURITY DEFINER, the permission
--     checked inside, and the app falls back until the migration is applied.
--
--     The ILIKE pattern must be a plan-time literal for pg_trgm to extract
--     trigrams; a bound parameter would silently disable the index. The
--     function therefore builds its statement with format(), inlining every
--     caller value with %L (a quoted literal). Identifiers in the generated
--     SQL are fixed strings, so nothing from the caller is ever spliced in
--     unquoted.
--
-- Not changed: no RLS policy, grant or function body. The PostgREST table
-- query keeps working and stays the fallback; search results are identical
-- either way (verified row-for-row in a throwaway Postgres). Search terms
-- shorter than three characters produce no trigrams and fall back to a
-- sequential scan inside the function -- the same plan as today, so that is
-- no worse and cannot change results.
--
-- Locks: every KlinikAid migration runs in one transaction, and CREATE INDEX
-- CONCURRENTLY cannot run inside a transaction block, so this is a plain
-- CREATE INDEX. It takes a SHARE lock on system_logs that briefly blocks
-- writes; public.system_logs holds about 7,500 rows / 2 MB, so the build is
-- sub-second. lock_timeout makes the build fail fast instead of queueing
-- app traffic behind a long-running transaction. If this table ever grows
-- to millions of rows, build the index with CREATE INDEX CONCURRENTLY
-- outside a transaction instead.
--
-- ORDERING: independent of 43-45 (no policy, function or table overlap);
-- apply in any order after 42. The app's search call falls back to the
-- table query until this is applied (PGRST202), so either order deploys
-- safely; apply this one before expecting the search to use the index.
-- SNAPSHOT: written but not applied; do not regenerate schema.sql until applied.
-- ROLLBACK: begin;
--   drop index if exists public.idx_system_logs_description_trgm;
--   drop function if exists public.search_system_logs(text, uuid, timestamptz, timestamptz, text, integer, integer);
--   commit;
--   (The app's fallback keeps the search working after a rollback.)
-- VERIFY: EXPLAIN ANALYZE of the page and count queries before/after, and of
-- the search_system_logs call itself, as authenticated with admin claims on
-- a throwaway Postgres seeded with ~200k rows -- see the PR.

begin;

-- Fail fast instead of queueing app traffic behind the SHARE lock CREATE
-- INDEX takes on system_logs while it builds.
set local lock_timeout = '5s';

create extension if not exists pg_trgm with schema extensions;

create index if not exists idx_system_logs_description_trgm
  on public.system_logs
  using gin (description extensions.gin_trgm_ops);

create or replace function public.search_system_logs(
  p_event_type text default null,
  p_user_id uuid default null,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null,
  -- An ILIKE pattern the caller already escaped (the app sends the output
  -- of containsPattern), not a raw search term.
  p_search text default null,
  p_from integer default 0,
  p_limit integer default 15
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- The API clamps these the same way; clamping again keeps a direct
  -- PostgREST call inside one page.
  v_limit integer := greatest(least(coalesce(p_limit, 15), 100), 1);
  v_offset integer := greatest(coalesce(p_from, 0), 0);
  v_where text := ' where true';
  v_total bigint;
  v_logs jsonb;
begin
  -- The same gate as the "Admins can view system logs" policy: the same
  -- permission, the same is_active and MFA rules, once per call.
  if not public.user_has_permission((select auth.uid()), 'system_logs.read') then
    raise exception 'FORBIDDEN: Missing permission system_logs.read' using errcode = '42501';
  end if;

  -- Dynamic SQL is required for the index: pg_trgm extracts trigrams from
  -- the ILIKE pattern at plan time, so the pattern must be a literal in the
  -- statement text. Every caller value goes through format %L below; the
  -- identifiers around them are fixed strings in this function.
  if p_event_type is not null then
    v_where := v_where || format(' and l.event_type = %L', p_event_type);
  end if;
  if p_user_id is not null then
    v_where := v_where || format(' and l.user_id = %L', p_user_id::text);
  end if;
  if p_start_date is not null then
    v_where := v_where || format(' and l.created_at >= %L', p_start_date::text);
  end if;
  if p_end_date is not null then
    v_where := v_where || format(' and l.created_at <= %L', p_end_date::text);
  end if;
  if p_search is not null then
    v_where := v_where || format(' and l.description ilike %L', p_search);
  end if;

  -- Two statements, like the two PostgREST issues today (exact count, then
  -- the page). One statement that reads a materialized CTE twice was tried
  -- and lost the index: the planner reorganizes the quals until the ILIKE
  -- stops being an index condition, and it degrades to a sequential scan.
  -- Single-reference statements keep the bitmap scan on the trigram index.
  execute format('select count(*) from public.system_logs l %s', v_where) into v_total;

  -- The count needs no profiles join: profiles.id is unique, so a log row
  -- matches at most one profile and the LEFT JOIN cannot change the count.
  -- The page join below keeps the profiles embed's own visibility.
  execute format($q$
    select coalesce(jsonb_agg(to_jsonb(f) order by f.created_at desc, f.id desc), '[]'::jsonb)
      from (select l.id, l.user_id, l.event_type, l.description,
                   l.ip_address, l.metadata, l.created_at,
                   pr.full_name as profile_full_name, pr.role as profile_role
              from public.system_logs l
              left join public.profiles pr
                on pr.id = l.user_id
               and (    (select auth.uid()) = pr.id
                     or (select public.user_has_permission((select auth.uid()), 'profiles.read_staff'))
                     or (select public.user_has_permission((select auth.uid()), 'profiles.manage')))
              %s
             order by l.created_at desc, l.id desc
             limit %s offset %s) f
  $q$, v_where, v_limit, v_offset) into v_logs;

  return jsonb_build_object('total', v_total, 'logs', v_logs);
end;
$$;

revoke all on function public.search_system_logs(text, uuid, timestamptz, timestamptz, text, integer, integer)
  from public, anon;
grant execute on function public.search_system_logs(text, uuid, timestamptz, timestamptz, text, integer, integer)
  to authenticated, service_role;

commit;
