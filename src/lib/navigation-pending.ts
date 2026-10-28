/**
 * Deciding when a client navigation should show pending feedback (issue #182).
 *
 * A route's first visit shows its `loading.tsx` skeleton, but a repeat visit
 * to an already-visited route shows nothing: the previous page stays on screen
 * while the RSC request runs, which reads as a frozen application. The pending
 * indicator is the only feedback a repeat navigation gets, so it has to be
 * raised on the click itself and put away when the new content is on screen.
 *
 * The rules below mirror the ones the Next.js router applies to a click, so the
 * indicator never claims a navigation the router is not going to perform: a
 * modified click opens a new tab (no client navigation happens), and a click on
 * the route that is already on screen navigates nowhere.
 */

/** The parts of a mouse event that decide whether a click navigates. */
export interface NavigationClick {
  /** `MouseEvent.button`. 0 is the primary button; anything else is a secondary one. */
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** True when another handler already cancelled the click. */
  defaultPrevented: boolean;
}

/**
 * The click fields the router rules read, from a React mouse event.
 *
 * The click is the only input that starts a navigation, so every caller passes
 * the click it is handling; keeping the mapping in one place means the sidebar
 * and the in-page links cannot drift apart in what they report.
 */
export function navigationClickFrom(event: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}): NavigationClick {
  return {
    button: event.button,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    defaultPrevented: event.defaultPrevented,
  };
}

/**
 * True when the click is not the plain left click the router navigates on.
 *
 * The browser takes these over: they open a new tab or window, so no client
 * navigation happens and nothing is pending.
 */
export function isModifiedClick(click: NavigationClick): boolean {
  return (
    click.metaKey ||
    click.ctrlKey ||
    click.shiftKey ||
    click.altKey ||
    click.button !== 0
  );
}

/** The path part of a link target, without its query string or fragment. */
export function targetPath(href: string): string {
  const withoutFragment = href.split("#")[0];
  const withoutQuery = withoutFragment.split("?")[0];
  return withoutQuery;
}

/**
 * Whether a click on `href` should raise the pending indicator.
 *
 * @param click - The click the router is about to act on.
 * @param href - The link target.
 * @param currentPathname - The path currently on screen.
 */
export function shouldStartPendingNavigation(
  click: NavigationClick,
  href: string,
  currentPathname: string
): boolean {
  if (click.defaultPrevented) return false;
  if (isModifiedClick(click)) return false;
  if (!href) return false;
  // The route already on screen: the router has nothing to fetch, so there is
  // nothing to wait for and the indicator would never be put away.
  return targetPath(href) !== currentPathname;
}
