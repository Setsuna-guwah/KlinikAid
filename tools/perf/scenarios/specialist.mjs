/**
 * Medical specialist: dashboard, patient directory, patient analytics.
 *
 * Read-only: it searches the directory and views a patient's analytics. It
 * never enters, edits or archives a record, and never clicks "Enter Record" or
 * "Archive".
 *
 * Environment:
 *   PERF_PATIENT_NAME  the name the specialist searches for. Use a token that
 *                      only the throwaway patient matches, such as its last
 *                      name. The directory search matches first or last name
 *                      one at a time, so a two-word name finds nothing. Unset:
 *                      the search and analytics actions are skipped without an
 *                      error.
 *
 * The throwaway patient must exist in the specialist's own directory
 * (`specialist_patients`, owned by the specialist account) with records, so its
 * analytics chart renders.
 */
import { clickSidebar } from "../lib.mjs";

const DIRECTORY_EMPTY = "No patients in this directory yet.";
const ANALYTICS_LINK = "a[href$='/analytics']";

const kpiReady = (page) =>
  page.waitForFunction(() =>
    [...document.querySelectorAll("main .text-3xl")].some((el) => /^\d+$/.test(el.textContent.trim())),
  );

// The dashboard also links to analytics pages, so the route must have changed too.
const directoryReady = (page) =>
  page.waitForFunction(
    // document.body is null until the parser has created it on a hard load.
    ({ link, empty }) =>
      location.pathname.endsWith("/specialist/patients") &&
      (document.querySelectorAll(link).length > 0 || (document.body?.innerText ?? "").includes(empty)),
    { link: ANALYTICS_LINK, empty: DIRECTORY_EMPTY },
  );

const profileReady = (page) =>
  page.getByRole("heading", { name: "Account Settings" }).first().waitFor({ state: "visible" });

const chartReady = (page) => page.locator(".recharts-wrapper").first().waitFor({ state: "visible" });

export default {
  name: "specialist",
  role: "medical_specialist",
  landing: /\/specialist\/dashboard/,
  async run({ page, measure, baseURL }) {
    const url = (path) => new URL(path, baseURL).href;
    const patientName = process.env.PERF_PATIENT_NAME;

    await measure("hard load Specialist Dashboard", {
      kind: "hard-load",
      action: () => page.goto(url("/specialist/dashboard"), { waitUntil: "commit" }),
      ready: () => kpiReady(page),
    });

    await measure("sidebar Specialist Dashboard -> My Patients", {
      kind: "navigation",
      action: () => clickSidebar(page, "My Patients"),
      ready: () => directoryReady(page),
    });

    await measure("sidebar My Patients -> My Profile", {
      kind: "navigation",
      action: () => clickSidebar(page, "My Profile"),
      ready: () => profileReady(page),
    });

    await measure("sidebar My Profile -> Specialist Dashboard", {
      kind: "navigation",
      action: () => clickSidebar(page, "Specialist Dashboard"),
      ready: () => kpiReady(page),
    });

    // Hard loads below leave a list page first, unmeasured: its in-flight
    // prefetches to patient routes never answer, and measure() waits on them.
    await page.goto(url("/profile"), { waitUntil: "load" });

    await measure("hard load My Patients", {
      kind: "hard-load",
      action: () => page.goto(url("/specialist/patients"), { waitUntil: "commit" }),
      ready: () => directoryReady(page),
    });

    if (patientName) {
      const search = page.getByPlaceholder("Search patient name or code");

      await measure("search directory for the throwaway patient", {
        kind: "interaction",
        action: () => search.fill(patientName),
        // The search is debounced and fetched, so wait for its response. The
        // roster can already hold a matching row, which would pass at once.
        ready: async () => {
          await page.waitForResponse(
            (response) => response.url().includes("/api/specialist/patients") && response.url().includes(encodeURIComponent(patientName)),
          );
          await page.waitForFunction(
            (needle) => {
              // Rows that carry an Analytics link are patient rows. The loading
              // row has none.
              const rows = [...document.querySelectorAll("tbody tr")].filter((row) => row.querySelector("a[href$='/analytics']"));
              return rows.length > 0 && rows.every((row) => row.textContent.includes(needle));
            },
            patientName,
          );
        },
      });

      const analyticsLink = page.locator("tr", { hasText: patientName }).locator(ANALYTICS_LINK).first();
      const analyticsHref = await analyticsLink.getAttribute("href");

      await measure("open the throwaway patient's analytics", {
        kind: "navigation",
        action: () => analyticsLink.click(),
        ready: () => chartReady(page),
      });

      await measure("scroll analytics to the last record", {
        kind: "scroll",
        action: async () => {
          const box = await page.locator("main").boundingBox();
          if (!box) return;
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.wheel(0, 100_000);
        },
        ready: () =>
          page.waitForFunction(() => {
            const rows = document.querySelectorAll("main table tbody tr");
            const last = rows[rows.length - 1];
            const main = document.querySelector("main");
            if (!last || !main) return false;
            const row = last.getBoundingClientRect();
            const area = main.getBoundingClientRect();
            return row.top >= area.top && row.bottom <= area.bottom + 1;
          }),
      });

      if (analyticsHref) {
        await page.goto(url("/profile"), { waitUntil: "load" });

        await measure("hard load the throwaway patient's analytics", {
          kind: "hard-load",
          action: () => page.goto(url(analyticsHref), { waitUntil: "commit" }),
          ready: () => chartReady(page),
        });
      }
    }
  },
};
