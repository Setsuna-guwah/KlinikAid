import { describe, expect, it } from "vitest";
import {
  isModifiedClick,
  navigationClickFrom,
  shouldStartPendingNavigation,
  targetPath,
  type NavigationClick,
} from "./navigation-pending";

const plainClick: NavigationClick = {
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  defaultPrevented: false,
};

describe("isModifiedClick", () => {
  it("does not treat a plain left click as modified", () => {
    expect(isModifiedClick(plainClick)).toBe(false);
  });

  it.each([
    ["meta", { metaKey: true }],
    ["ctrl", { ctrlKey: true }],
    ["shift", { shiftKey: true }],
    ["alt", { altKey: true }],
    ["middle", { button: 1 }],
  ])("treats a %s click as modified", (_name, patch) => {
    expect(isModifiedClick({ ...plainClick, ...patch })).toBe(true);
  });
});

describe("navigationClickFrom", () => {
  it("reads every rule field off the event, so a modified click stays modified", () => {
    expect(
      navigationClickFrom({
        button: 0,
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        defaultPrevented: false,
      })
    ).toEqual({ ...plainClick, metaKey: true });
  });

  it("carries a cancelled click through rather than reporting a plain one", () => {
    // A link that cancelled its own click (a confirmation, an already-handled
    // navigation) must not raise an indicator: it would never be put away.
    expect(
      navigationClickFrom({
        button: 0,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        defaultPrevented: true,
      }).defaultPrevented
    ).toBe(true);
  });
});

describe("targetPath", () => {
  it("drops the query string and the fragment", () => {
    expect(targetPath("/admin/staff?role=7")).toBe("/admin/staff");
    expect(targetPath("/admin/staff#top")).toBe("/admin/staff");
    expect(targetPath("/admin/staff?role=7#top")).toBe("/admin/staff");
  });
});

describe("shouldStartPendingNavigation", () => {
  it("raises the indicator for a plain click on another route", () => {
    // The repeat visit to an already-visited route is the case issue #182 is
    // about: there is no skeleton to fall back on, so the indicator is the
    // only feedback the user gets.
    expect(
      shouldStartPendingNavigation(plainClick, "/admin/roles", "/admin/staff")
    ).toBe(true);
  });

  it("does not raise the indicator for a modified click", () => {
    // The browser opens a new tab for these, so no client navigation happens
    // and an indicator would wait for a navigation that never arrives.
    expect(
      shouldStartPendingNavigation(
        { ...plainClick, metaKey: true },
        "/admin/roles",
        "/admin/staff"
      )
    ).toBe(false);
  });

  it("does not raise the indicator when the click was already cancelled", () => {
    expect(
      shouldStartPendingNavigation(
        { ...plainClick, defaultPrevented: true },
        "/admin/roles",
        "/admin/staff"
      )
    ).toBe(false);
  });

  it("does not raise the indicator for the route already on screen", () => {
    // The router has nothing to fetch, so there is nothing to wait for and
    // the indicator would never be put away.
    expect(
      shouldStartPendingNavigation(plainClick, "/admin/staff", "/admin/staff")
    ).toBe(false);
  });

  it("does not raise the indicator for a link to the same route with a query", () => {
    expect(
      shouldStartPendingNavigation(
        plainClick,
        "/admin/staff?role=7",
        "/admin/staff"
      )
    ).toBe(false);
  });

  it("does not raise the indicator for an empty target", () => {
    expect(shouldStartPendingNavigation(plainClick, "", "/admin/staff")).toBe(
      false
    );
  });
});
