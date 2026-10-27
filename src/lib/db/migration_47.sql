-- KlinikAid Migration 47: stop the profiles self-update policy recursing (#256)
-- Why: any patient UPDATE of their own public.profiles row failed with
--   infinite recursion detected in policy for relation "profiles"
-- (SQLSTATE 42P17). The policy "Users can update own profile details" guarded
-- the protected columns (role, role_id, department, is_active,
-- email_verified_at) with WITH CHECK sub-selects on public.profiles itself.
-- Expanding those sub-selects re-applies the profiles policies, which Postgres
-- refuses. A failed save is not a client problem: it blocks
-- accepted_privacy_at from src/app/(auth)/privacy-agreement/actions.ts and the
-- mobile sign-up consent, so no new patient can record their privacy consent.
-- Reported by @JudgementKazzy2023, who also suggested the fix.
--
-- What changes:
--   1. public.protect_profile_columns(), a BEFORE UPDATE FOR EACH ROW trigger
--      on public.profiles, keeps the protected columns locked by comparing NEW
--      with OLD instead of re-reading the row in a policy. A change to any of
--      the five is allowed only for a non end-user session (service_role,
--      SECURITY DEFINER functions) or a caller holding profiles.manage;
--      otherwise it raises 42501. The trigger is the same protection the old
--      WITH CHECK provided, expressed so it cannot recurse.
--   2. "Users can update own profile details" keeps the same name, command and
--      roles, with WITH CHECK reduced to (select auth.uid()) = id. USING is
--      unchanged, so an inactive patient still cannot update their own row.
-- The protected-column protection moves from the policy to the trigger; no
-- other policy changes, no grants to tables change.
--
-- Trigger ordering on public.profiles: the only other BEFORE trigger is
-- profiles_sync_legacy_role (BEFORE INSERT OR UPDATE OF role_id, role), which
-- derives NEW.role from role_id. BEFORE ROW triggers fire in name order, so
-- "profiles_sync_legacy_role" runs before "protect_profile_columns": the guard
-- compares the legacy-derived role it is about to write, not the caller's raw
-- value. A role_id or role change is still rejected for a non-admin. The
-- SECURITY DEFINER writers (sync_email_verified_at, sync_profile_legacy_role,
-- sync_profiles_for_changed_role) run as their owner, so current_user is not
-- 'authenticated'/'anon' and the guard lets them through.
--
-- ORDERING: 43 is already applied, and its "Users can update own profile
-- details" re-creates the recursive policy this migration replaces, so apply 47
-- AFTER 43. 47 does not depend on 44, 45 or 46. If 43 is ever re-run, re-run 47
-- afterwards, or the recursive policy comes back.
-- SNAPSHOT: written but not applied; do not regenerate schema.sql until applied.
-- ROLLBACK: drop trigger protect_profile_columns on public.profiles; drop
-- function public.protect_profile_columns(); re-create "Users can update own
-- profile details" from schema.sql (the recursive WITH CHECK). Access returns to
-- the #256 failure; no data is affected either way.

begin;

create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Nothing protected moved: every ordinary self-update (full_name,
  -- accepted_privacy_at, contact details) passes untouched.
  if (new.role, new.role_id, new.department, new.is_active, new.email_verified_at)
     is not distinct from
     (old.role, old.role_id, old.department, old.is_active, old.email_verified_at) then
    return new;
  end if;

  -- service_role, and SECURITY DEFINER triggers/functions (which run as their
  -- owner), are not end-user sessions. Only authenticated and anon are.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  -- The admin path the "profiles.manage" update policies already allow.
  if public.user_has_permission((select auth.uid()), 'profiles.manage') then
    return new;
  end if;

  raise exception 'Role, department, account status and email verification can only be changed by an administrator.'
    using errcode = '42501';
end;
$$;

revoke all on function public.protect_profile_columns() from public, anon;

drop trigger if exists protect_profile_columns on public.profiles;
create trigger protect_profile_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

drop policy if exists "Users can update own profile details" on public.profiles;
create policy "Users can update own profile details" on public.profiles
  for update
  to authenticated
  using (((select auth.uid()) = id) and (is_active is true))
  with check ((select auth.uid()) = id);

commit;
