import { clickSidebar } from "../lib.mjs";

/**
 * Admin: the pages an admin works in day to day, read-only. Nothing here
 * submits a form, exports a log, uploads or deletes a RAG document, or edits
 * staff or roles. Dialogs are opened and closed without saving.
 */

/** The date the logs tables print in their first column ("Oct 24, 2026"). */
const LOG_DATE = /[A-Z][a-z]{2} \d{2}, \d{4}/;
const LOADING_LOGS = /^Loading (audit|chatbot) logs/;

async function dashboardReady(page) {
  // KPI counts (the skeleton renders empty bars, not numbers) and the chart.
  await page.locator("div.text-2xl.font-bold").filter({ hasText: /^\d+$/ }).nth(3).waitFor({ state: "visible" });
  await page.locator(".recharts-surface").first().waitFor({ state: "visible" });
}

async function staffReady(page) {
  await page.getByRole("button", { name: /^Edit / }).first().waitFor({ state: "visible" });
}

async function rolesReady(page) {
  await page.locator("nav[aria-label='Roles'] button").first().waitFor({ state: "visible" });
}

async function ragReady(page) {
  // A document row, or the empty-state row when nothing is indexed yet.
  await page.locator("tbody tr").first().waitFor({ state: "visible" });
}

/**
 * The System Events and Chatbot Audit tables. The loader only shows while a
 * fetch is in flight, so a short attach wait keeps the detach check from
 * passing on the previous page's rows before the new fetch has started.
 */
async function logRowsReady(page, { waitForFetch = true } = {}) {
  if (waitForFetch) {
    await page.getByText(LOADING_LOGS).first().waitFor({ state: "attached", timeout: 500 }).catch(() => {});
    await page.getByText(LOADING_LOGS).first().waitFor({ state: "detached" });
  }
  await page.locator("tbody td", { hasText: LOG_DATE }).first().waitFor({ state: "visible" });
}

/** Wheel over the content until the table's last row is inside the viewport. */
async function scrollToLastRow(page, rowSelector) {
  await page.mouse.move(683, 430);
  for (let step = 0; step < 200; step += 1) {
    const inView = await page.evaluate((selector) => {
      const rows = document.querySelectorAll(selector);
      const last = rows[rows.length - 1];
      if (!last) return false;
      const rect = last.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= window.innerHeight;
    }, rowSelector);
    if (inView) return;
    await page.mouse.wheel(0, 800);
  }
}

async function lastRowInView(page, rowSelector) {
  await page.waitForFunction((selector) => {
    const rows = document.querySelectorAll(selector);
    const last = rows[rows.length - 1];
    if (!last) return false;
    const rect = last.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= window.innerHeight;
  }, rowSelector, { polling: "raf" });
}

/** Wheel back to the top so the next unmeasured step starts from the page top. */
async function scrollToTop(page) {
  await page.mouse.move(683, 430);
  for (let step = 0; step < 60; step += 1) await page.mouse.wheel(0, -1500);
}

async function closeOverlay(page, locator) {
  await page.keyboard.press("Escape");
  await locator.waitFor({ state: "detached" });
}

export default {
  name: "admin",
  role: "admin",
  landing: /\/admin\/dashboard/,
  async run({ page, measure, baseURL }) {
    const url = (path) => new URL(path, baseURL).href;

    await measure("hard load /admin/dashboard", {
      kind: "hard-load",
      action: () => page.goto(url("/admin/dashboard"), { waitUntil: "commit" }),
      ready: () => dashboardReady(page),
    });

    // The sequence starts on the dashboard the hard load just opened, so the
    // leading "Dashboard" click would be a no-op. It is measured as the
    // return visit at the end of the sequence instead.
    await measure("sidebar Dashboard -> Staff Management", {
      kind: "navigation",
      action: () => clickSidebar(page, "Staff Management"),
      ready: () => staffReady(page),
    });
    await measure("sidebar Staff Management -> Role Management", {
      kind: "navigation",
      action: () => clickSidebar(page, "Role Management"),
      ready: () => rolesReady(page),
    });
    await measure("sidebar Role Management -> RAG Manager", {
      kind: "navigation",
      action: () => clickSidebar(page, "RAG Manager"),
      ready: () => ragReady(page),
    });
    await measure("sidebar RAG Manager -> System Logs", {
      kind: "navigation",
      action: () => clickSidebar(page, "System Logs"),
      ready: () => logRowsReady(page),
    });
    await measure("sidebar System Logs -> Dashboard", {
      kind: "navigation",
      action: () => clickSidebar(page, "Dashboard"),
      ready: () => dashboardReady(page),
    });

    // Staff registry: hard load, then scroll, search and the Add Staff form.
    await measure("hard load /admin/staff", {
      kind: "hard-load",
      action: () => page.goto(url("/admin/staff"), { waitUntil: "commit" }),
      ready: () => staffReady(page),
    });

    await measure("staff registry: scroll to bottom", {
      kind: "scroll",
      action: () => scrollToLastRow(page, "tbody tr"),
      ready: () => lastRowInView(page, "tbody tr"),
    });
    await scrollToTop(page);

    // Search by the first listed person's name, so the filter has a known match.
    const firstEdit = await page.getByRole("button", { name: /^Edit / }).first().getAttribute("aria-label");
    const staffName = firstEdit.replace(/^Edit /, "");
    const countBefore = await page.getByTestId("staff-count").textContent();
    await measure("staff registry: search by name", {
      kind: "interaction",
      action: () => page.getByPlaceholder("Search by name, email, or role...").fill(staffName),
      ready: async () => {
        await page.waitForFunction(
          (before) => document.querySelector('[data-testid="staff-count"]')?.textContent !== before,
          countBefore,
        );
        await page.getByRole("button", { name: `Edit ${staffName}`, exact: true }).first().waitFor({ state: "visible" });
      },
    });
    await page.getByPlaceholder("Search by name, email, or role...").fill("");
    await staffReady(page);

    await measure("staff registry: open Add Staff form", {
      kind: "interaction",
      action: () => page.getByRole("button", { name: "Add Staff", exact: true }).click(),
      ready: () => page.getByTestId("staff-sheet").locator("form").waitFor({ state: "visible" }),
    });
    // Closed without submitting.
    await closeOverlay(page, page.getByTestId("staff-sheet"));

    // Role management: hard load, the Permissions tab, then another role.
    await measure("hard load /admin/roles", {
      kind: "hard-load",
      action: () => page.goto(url("/admin/roles"), { waitUntil: "commit" }),
      ready: () => rolesReady(page),
    });

    await measure("roles: switch to Permissions tab", {
      kind: "interaction",
      action: () => page.getByRole("tab", { name: /^Permissions/ }).click(),
      ready: () =>
        page.getByRole("tabpanel", { name: /^Permissions/ }).getByRole("switch").first().waitFor({ state: "visible" }),
    });

    const otherRole = page.locator("nav[aria-label='Roles'] button").nth(1);
    const otherRoleLabel = await otherRole.locator("span.truncate").innerText();
    await measure("roles: select another role", {
      kind: "interaction",
      action: () => otherRole.click(),
      ready: () =>
        page.getByRole("heading", { level: 2 }).filter({ hasText: otherRoleLabel }).first().waitFor({ state: "visible" }),
    });

    // RAG manager: hard load, search, the read-only text viewer, and both
    // upload dialogs opened and closed without an upload.
    await measure("hard load /admin/rag", {
      kind: "hard-load",
      action: () => page.goto(url("/admin/rag"), { waitUntil: "commit" }),
      ready: () => ragReady(page),
    });

    const titles = await page.locator("tbody tr td:first-child").allInnerTexts();
    const ragDocs = titles.length > 0 && !titles[0].includes("No RAG documents indexed yet");
    if (ragDocs) {
      const docTitle = titles[0].trim();
      const expectedRows = titles.filter((title) => title.toLowerCase().includes(docTitle.toLowerCase())).length;

      await measure("RAG: search knowledge documents", {
        kind: "interaction",
        action: () => page.getByPlaceholder("Search knowledge documents...").fill(docTitle),
        ready: () =>
          page.waitForFunction((expected) => document.querySelectorAll("tbody tr").length === expected, expectedRows),
      });
      await page.getByPlaceholder("Search knowledge documents...").fill("");
      await ragReady(page);

      await measure("RAG: view indexed text of a document", {
        kind: "interaction",
        action: () => page.getByRole("button", { name: `View the indexed text of ${docTitle}`, exact: true }).first().click(),
        ready: async () => {
          const viewer = page.getByTestId("rag-document-viewer");
          await viewer.waitFor({ state: "visible" });
          await viewer.getByText("Loading the indexed text...").waitFor({ state: "detached" });
        },
      });
      await closeOverlay(page, page.getByTestId("rag-document-viewer"));
    }

    await measure("RAG: open Add Plain Text dialog", {
      kind: "interaction",
      action: () => page.getByRole("button", { name: "Add Plain Text", exact: true }).click(),
      ready: () => page.getByRole("dialog").locator("input, textarea").first().waitFor({ state: "visible" }),
    });
    await closeOverlay(page, page.getByRole("dialog"));

    await measure("RAG: open Upload PDF dialog", {
      kind: "interaction",
      action: () => page.getByRole("button", { name: "Upload PDF", exact: true }).click(),
      ready: () => page.getByRole("dialog").locator('input[type="file"]').first().waitFor({ state: "attached" }),
    });
    await closeOverlay(page, page.getByRole("dialog"));

    // System logs: hard load, scroll, pagination, search and the other tabs.
    await measure("hard load /admin/logs", {
      kind: "hard-load",
      action: () => page.goto(url("/admin/logs"), { waitUntil: "commit" }),
      ready: () => logRowsReady(page),
    });

    await measure("system logs: scroll to bottom", {
      kind: "scroll",
      action: () => scrollToLastRow(page, "tbody tr"),
      ready: () => lastRowInView(page, "tbody tr"),
    });
    await scrollToTop(page);

    await measure("system logs: next page", {
      kind: "interaction",
      action: () => page.getByRole("button", { name: "Next", exact: true }).click(),
      ready: () => logRowsReady(page),
    });
    await measure("system logs: previous page", {
      kind: "interaction",
      action: () => page.getByRole("button", { name: "Previous", exact: true }).click(),
      ready: () => logRowsReady(page),
    });

    const logDescription = (await page.locator("tbody tr td:nth-child(4)").first().innerText()).trim();
    await measure("system logs: search descriptions", {
      kind: "interaction",
      action: async () => {
        await page.getByPlaceholder("Search logs description...").fill(logDescription);
        await page.getByRole("button", { name: "Search", exact: true }).click();
      },
      ready: async () => {
        await logRowsReady(page);
        await page.locator("tbody tr", { hasText: logDescription }).first().waitFor({ state: "visible" });
      },
    });

    await measure("system logs: switch to Chatbot Audit", {
      kind: "interaction",
      action: () => page.getByRole("button", { name: "Chatbot Audit", exact: true }).click(),
      ready: () => logRowsReady(page),
    });
    await measure("system logs: switch to API Cost Tracker", {
      kind: "interaction",
      action: () => page.getByRole("button", { name: "API Cost Tracker", exact: true }).click(),
      ready: () => page.getByRole("cell", { name: /^Week of/ }).first().waitFor({ state: "visible" }),
    });
    await measure("system logs: switch to System Events", {
      kind: "interaction",
      action: () => page.getByRole("button", { name: "System Events", exact: true }).click(),
      // The rows are already in memory from before the tab switch.
      ready: () => logRowsReady(page, { waitForFetch: false }),
    });

    // Last: the profile page, from the sidebar.
    await measure("sidebar My Profile", {
      kind: "navigation",
      action: () => clickSidebar(page, "My Profile"),
      ready: () => page.getByText("Update Password", { exact: true }).waitFor({ state: "visible" }),
    });
  },
};
