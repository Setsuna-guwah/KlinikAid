-- KlinikAid Migration 48: let a searched page reuse the total it already counted
--
-- Why: CodeRabbit on PR #257 (thread PRRT_kwDOSkBlac6wrhwK, "Major"):
-- `readSearchedLogPage` did not forward the `knownTotal` a later page of the
-- same search sends, so every searched page re-ran the exact count even
-- though the caller already held the answer. The table path already skips
-- that count for the same request. For short search terms whose ILIKE has no
-- trigrams, later pages were repeating the full count scan for nothing.
--
-- NUMBERING: this was assigned as migration 47, but the master merge of
-- PR #258 brought its own migration_47.sql (the profiles self-update policy
-- hotfix, already applied). Numbers are unique per applied migration, so this
-- takes the next free number, 48.
--
-- What changes:
--   Drops the 7-argument public.search_system_logs from migration 46 and
--   recreates it with one added parameter, `p_known_total bigint default null`.
--   When that is non-null the count statement is skipped and the value is
--   returned as the total; when it is null the count runs as before.
--   Everything else is byte-for-byte migration 46's function: the same
--   system_logs.read gate (42501, same is_active and MFA rules), the same
--   inlined profiles SELECT policies in the join, the same dynamic ILIKE
--   pattern, search_path = '', SECURITY DEFINER, stable, and the same
--   revoke/grant, now on the new signature. Dropping the 7-argument form
--   instead of overloading it leaves one function, so PostgREST cannot pick
--   the wrong one.
--
-- ORDERING: apply after 46 (it replaces 46's function). The app passes
-- p_known_total and, when the call answers PGRST202 (this migration not
-- applied yet, so no function takes that argument), retries once without it
-- against the 7-argument function, which counts. Either order deploys safely;
-- apply this one before the searched pages stop recounting.
-- SNAPSHOT: written but not applied; do not regenerate schema.sql until applied.
-- ROLLBACK: begin;
--   drop function if exists public.search_system_logs(text, uuid, timestamptz, timestamptz, text, integer, integer, bigint);
--   commit;
--   then re-create the 7-argument definition from migration_46. The app's
--   retry keeps the search working with either version applied.
-- VERIFY: the count skip is observable without auto_explain (the image blocks
-- it): passing p_known_total = 999 must answer total 999 while the true count
-- is 81, and the call must run ~16 ms faster; as authenticated with admin
-- claims in a throwaway Postgres -- see the PR.

begin;

-- Fail fast instead of queueing app traffic behind the locks DROP FUNCTION
-- and CREATE FUNCTION take on system_logs and profiles.
set local lock_timeout = '5s';

drop function if exists public.search_system_logs(text, uuid, timestamptz, timestamptz, text, integer, integer);

create or replace function public.search_system_logs(
  p_event_type text default null,
  p_user_id uuid default null,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null,
  -- An ILIKE pattern the caller already escaped (the app sends the output
  -- of containsPattern), not a raw search term.
  p_search text default null,
  p_from integer default 0,
  p_limit integer default 15,
  -- The total the caller counted for these same filters on an earlier page.
  -- Non-null skips the count and is returned as the total, like the table
  -- path's knownTotal contract.
  p_known_total bigint default null
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

  -- A caller that already counted these filters keeps its total: skip the
  -- count, as the table path's knownTotal contract does. Only a null
  -- p_known_total counts here.
  if p_known_total is null then
    execute format('select count(*) from public.system_logs l %s', v_where) into v_total;
  else
    v_total := p_known_total;
  end if;

  -- Two statements, like the two PostgREST issues today (exact count, then
  -- the page). One statement that reads a materialized CTE twice was tried
  -- and lost the index: the planner reorganizes the quals until the ILIKE
  -- stops being an index condition, and it degrades to a sequential scan.
  -- Single-reference statements keep the bitmap scan on the trigram index.
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

revoke all on function public.search_system_logs(text, uuid, timestamptz, timestamptz, text, integer, integer, bigint)
  from public, anon;
grant execute on function public.search_system_logs(text, uuid, timestamptz, timestamptz, text, integer, integer, bigint)
  to authenticated, service_role;

commit;
