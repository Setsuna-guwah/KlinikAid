"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import Link, { useLinkStatus } from "next/link";
import {
  navigationClickFrom,
  shouldStartPendingNavigation,
  type NavigationClick,
} from "@/lib/navigation-pending";

/**
 * Pending feedback for client-side navigations (issue #182).
 *
 * A route's first visit shows its `loading.tsx` skeleton, but a repeat visit
 * to an already-visited route shows nothing at all: the page that is on
 * screen stays frozen while the RSC request runs, and only the sidebar's
 * active item moves. This module puts a pending indicator on the clicked
 * navigation within the click itself -- a spinner on the sidebar link and a
 * thin bar across the top -- and takes it away when the new content is on
 * screen.
 *
 * The state lives here, in one place, because the two halves of the indicator
 * are rendered in different parts of the tree (the sidebar and the shell).
 */

interface NavigationPendingValue {
  /** The href whose navigation is in flight, or null while nothing is pending. */
  pendingHref: string | null;
  /** Called by a link that was clicked. */
  startNavigation: (href: string, click: NavigationClick) => void;
  /** Called when the navigation for a href has finished. */
  finishNavigation: (href: string) => void;
}

const NavigationPendingContext = createContext<NavigationPendingValue>({
  pendingHref: null,
  startNavigation: () => {},
  finishNavigation: () => {},
});

/** The navigation that is in flight, and how to report one. */
export function useNavigationPending(): NavigationPendingValue {
  return useContext(NavigationPendingContext);
}

/**
 * Owns the pending state for the dashboard shell.
 *
 * The indicator is raised in the click handler rather than when the router
 * reports a pending navigation, because the router's own signal arrives a
 * tick later than the paint that follows the click.
 */
export function NavigationPendingProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  const startNavigation = useCallback(
    (href: string, click: NavigationClick) => {
      if (!shouldStartPendingNavigation(click, href, pathname)) return;
      setPendingHref(href);
    },
    [pathname]
  );

  const finishNavigation = useCallback((href: string) => {
    // A navigation that was superseded by a later one must not put away the
    // indicator of the navigation that is still running.
    setPendingHref((current) => (current === href ? null : current));
  }, []);

  // The route on screen changed, so the navigation the indicator was waiting
  // for has committed: the new content is on screen and the indicator goes
  // away with the old page.
  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  const value = useMemo(
    () => ({ pendingHref, startNavigation, finishNavigation }),
    [pendingHref, startNavigation, finishNavigation]
  );

  return (
    <NavigationPendingContext.Provider value={value}>
      {children}
      <NavigationPendingBar pending={pendingHref !== null} />
      <NavigationPendingStatus pending={pendingHref !== null} />
    </NavigationPendingContext.Provider>
  );
}

/**
 * The thin bar across the top of the window.
 *
 * The faint track is always on screen, so the indicator is there from the
 * first frame; the brighter segment slides along it while the navigation
 * runs. It is decorative: the state is announced once by the status region
 * below, and a bar that slides cannot be read out anyway.
 */
function NavigationPendingBar({ pending }: { pending: boolean }) {
  if (!pending) return null;

  return (
    <div
      aria-hidden="true"
      data-testid="navigation-progress"
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-primary/40"
    >
      <div className="h-full w-1/3 bg-primary animate-navigation-progress motion-reduce:w-full motion-reduce:animate-none" />
    </div>
  );
}

/**
 * The single live region for the dashboard.
 *
 * One polite status for the whole shell, rather than one per link, so a
 * screen reader is not interrupted once per navigation by every link that
 * happens to be on screen.
 */
function NavigationPendingStatus({ pending }: { pending: boolean }) {
  return (
    <p role="status" aria-live="polite" data-testid="navigation-status" className="sr-only">
      {pending ? "Loading the requested page" : ""}
    </p>
  );
}

interface PendingLinkProps extends Omit<React.ComponentProps<typeof Link>, "href"> {
  /** The target path, as a string: the pending signal is keyed by it. */
  href: string;
}

/**
 * A link that raises the shell's pending indicator, for navigations that start
 * inside a page rather than in the sidebar (issue #239).
 *
 * A card or a row link is a navigation like any other: it leaves the page on
 * screen while the RSC for the target arrives, and a repeat visit has no
 * skeleton to fall back on. The two routes the benchmark found with no feedback
 * at all -- a queue document's detail and a specialist patient's analytics --
 * are dynamic-id routes whose page calls notFound() after an await, so they
 * must not have a loading.tsx (issue #213: a boundary there streams the 200
 * status before the page can turn it into a 404). The click is then the only
 * moment a pending state can be raised, and it is raised here, in the click.
 *
 * The indicator itself is the shell's: one bar and one polite status for the
 * whole dashboard, so a page with twenty of these still makes one announcement
 * per navigation.
 */
export function PendingLink({ href, children, onClick, ...rest }: PendingLinkProps) {
  const { pendingHref, startNavigation } = useNavigationPending();

  // The link is busy while its navigation runs, as the sidebar's links are: the
  // content behind it is still the page the user just left.
  return (
    <Link
      href={href}
      aria-busy={pendingHref === href || undefined}
      onClick={(event) => {
        startNavigation(href, navigationClickFrom(event));
        onClick?.(event);
      }}
      {...rest}
    >
      {children}
      <NavigationPendingSignal href={href} />
    </Link>
  );
}

/**
 * Reports the end of a navigation back to the provider.
 *
 * `useLinkStatus` is Next's own pending signal for a link: it is true from
 * the click until that link's navigation settles. The hook only works inside
 * a Next.js link element, so this child -- rendered as one of the link's
 * children -- is how the provider hears about it.
 *
 * It covers the two cases the route itself cannot: a navigation that fails
 * leaves the route on screen unchanged, and a navigation that only changes the
 * query string does the same. Without this the indicator would stay up for a
 * navigation that is already over.
 */
export function NavigationPendingSignal({ href }: { href: string }) {
  const { pending } = useLinkStatus();
  const { finishNavigation } = useNavigationPending();
  const wasPending = useRef(false);

  useEffect(() => {
    if (pending) {
      wasPending.current = true;
      return;
    }
    if (wasPending.current) {
      wasPending.current = false;
      finishNavigation(href);
    }
  }, [pending, href, finishNavigation]);

  return null;
}
