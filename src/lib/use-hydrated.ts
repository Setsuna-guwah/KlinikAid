"use client";

import { useEffect, useState } from "react";

/**
 * Whether this component has finished hydrating on the client.
 *
 * ## Why this exists
 *
 * Any value computed from the current clock is a hydration hazard. The server
 * renders at T, the browser hydrates at T+n; if a birthday falls inside that gap
 * the two renders disagree, React discards the server HTML for the subtree, and
 * the console fills with a warning the next maintainer learns to ignore.
 *
 * Reading a clock *during render* cannot be made safe -- there is no way for the
 * value to be correct on the server and identical on the client without knowing
 * the future. The only correct fix is to not render the value on the first
 * paint and compute it after mount, when there is no server HTML to disagree
 * with.
 *
 * Cost: the value is absent for one paint. That is the right trade, because
 * these are derived annotations (an age, an elapsed duration) rather than the
 * clinical content itself, and they appear immediately after mount.
 *
 * The alternative -- reading `Date.now()` during render -- is what this hook
 * exists to replace. Where a helper computes something from the clock, pass the
 * reference time in explicitly instead (see `getAge`), so the choice is visible
 * at the call site rather than hidden inside a shared function.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return hydrated;
}