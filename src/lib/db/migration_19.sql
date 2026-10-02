-- KlinikAid Migration 19: Close the self-service privilege escalation on public.profiles
--
-- CONTEXT
-- schema.sql:168-171 ships an UPDATE policy whose WITH CHECK pins only the legacy
-- `role` TEXT column:
--
--   WITH CHECK (auth.uid() = id AND role = (SELECT role FROM public.profiles WHERE id = auth.uid()))
--
-- Every live permission check resolves through `role_id` (user_has_permission ->
-- role_permissions), and `department` is the isolation predicate for the
-- cross-department RLS policies. `is_active` is consulted by no policy at all.
-- Because the policy never pinned them, any authenticated account -- including a
-- patient -- could rewrite all three on its own row.
--
-- CONFIRMED LIVE against the deployed database: an ordinary `department_staff`
-- session, holding only the browser-public anon key plus its own JWT, set
--   role_id   -> a6427a7a-2122-4058-86ff-d76636709cb5   (admin)   -- write landed
--   department-> 'ecg'                                                  -- write landed
-- and both changes persisted. requirePermission() (src/lib/auth/helpers.ts:147)
-- resolves through user_has_permission(), so the role_id write granted that
-- account every admin permission on every API route using that guard.
--
-- This migration pins all four privileged columns. The subquery form deliberately
-- mirrors the one already in use at schema.sql:171, so it reads the pre-update
-- row via the existing "Users can read own profile" SELECT policy (schema.sql:164).

DROP POLICY IF EXISTS "Users can update own profile details" ON public.profiles;

CREATE POLICY "Users can update own profile details"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    -- IS NOT DISTINCT FROM, not =, so a NULL held by a NULL-holder stays legal
    -- while a change from NULL to a real value is still blocked.
    AND role        IS NOT DISTINCT FROM (SELECT p.role        FROM public.profiles p WHERE p.id = auth.uid())
    AND role_id     IS NOT DISTINCT FROM (SELECT p.role_id     FROM public.profiles p WHERE p.id = auth.uid())
    AND department  IS NOT DISTINCT FROM (SELECT p.department  FROM public.profiles p WHERE p.id = auth.uid())
    AND is_active   IS NOT DISTINCT FROM (SELECT p.is_active   FROM public.profiles p WHERE p.id = auth.uid())
  );

-- Privileged columns remain writable by staff who actually hold the permission,
-- which is what the admin routes already use. Without this, an admin editing a
-- user's role_id through the UI would be rejected by the policy above only if
-- they were editing their own row -- they are not, so USING/WITH CHECK on their
-- own id fails and the legitimate admin path breaks. Grant it explicitly.
DROP POLICY IF EXISTS "Users with profiles.manage can update any profile" ON public.profiles;

CREATE POLICY "Users with profiles.manage can update any profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (public.user_has_permission(auth.uid(), 'profiles.manage'))
  WITH CHECK (public.user_has_permission(auth.uid(), 'profiles.manage'));

-- ---------------------------------------------------------------------------
-- VERIFICATION (run after applying; expect the first two rows only)
--   SELECT policyname, cmd, qual, with_check FROM pg_policies
--    WHERE tablename = 'profiles' AND cmd = 'UPDATE';
-- ---------------------------------------------------------------------------