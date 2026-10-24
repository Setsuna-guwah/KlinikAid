/**
 * Department staff (laboratory): records queue, history, record entry.
 *
 * Read-only: it views the queue and history, searches them and opens the
 * result-entry form. It never submits, saves or edits a result.
 *
 * Environment:
 *   PERF_PATIENT_ID  the `patients.id` of the throwaway patient. The record-entry
 *                    action opens that patient's entry form by URL, since the
 *                    queue only lists real patients. Unset: the record-entry
 *                    action is skipped without an error.
 *
 * The account must be a `department_staff` created with `--department laboratory`.
 */
import { clickSidebar } from "../lib.mjs";

const OPEN_QUEUE = /Open Queue \(\d+\)/;
const REPORTS = /^\d+ reports$/;
const SEARCH_INPUT = "Search patient or test...";
const QUEUE_EMPTY_OR_ENTRY = /No patients queued|Enter Results|Edit Results/;

const recordsReady = (page) => page.getByRole("button", { name: OPEN_QUEUE }).first().waitFor({ state: "visible" });

const profileReady = (page) =>
  page.getByRole("heading", { name: "Account Settings" }).first().waitFor({ state: "visible" });

const historyReady = (page) => page.getByText(REPORTS).first().waitFor({ state: "visible" });

/** Reads the "N reports" count of the history tab. */
async function reportTotal(page) {
  const text = (await page.getByText(REPORTS).first().textContent()) ?? "";
  return text.trim();
}

/** Last name token of the first history report, or null when there are none. */
async function firstHistoryTerm(page) {
  const name = ((await page.locator("h3.font-extrabold").first().textContent({ timeout: 2_000 }).catch(() => "")) ?? "").trim();
  return name ? name.split(/\s+/).at(-1) : null;
}

export default {
  name: "department",
  role: "department_staff",
  landing: /\/department\/(dashboard|records)/,
  async run({ page, measure, baseURL }) {
    const url = (path) => new URL(path, baseURL).href;
    const patientId = process.env.PERF_PATIENT_ID;

    // Hard loads below leave a list page first, unmeasured: its in-flight
    // prefetches to record routes never answer, and measure() waits on them.
    await page.goto(url("/profile"), { waitUntil: "load" });

    await measure("hard load Dept Records", {
      kind: "hard-load",
      action: () => page.goto(url("/department/records"), { waitUntil: "commit" }),
      ready: () => recordsReady(page),
    });

    // Redirects to /department/records after its permission check.
    await measure("hard load Department Dashboard (redirects to records)", {
      kind: "hard-load",
      action: () => page.goto(url("/department/dashboard"), { waitUntil: "commit" }),
      ready: () => recordsReady(page),
    });

    await measure("sidebar Dept Records -> My Profile", {
      kind: "navigation",
      action: () => clickSidebar(page, "My Profile"),
      ready: () => profileReady(page),
    });

    await measure("sidebar My Profile -> Dept Records", {
      kind: "navigation",
      action: () => clickSidebar(page, "Dept Records"),
      ready: () => recordsReady(page),
    });

    const historyTab = page.getByRole("button", { name: /Records History/ });
    const queueTab = page.getByRole("button", { name: /Open Queue/ });

    await measure("switch to Records History tab", {
      kind: "interaction",
      action: () => historyTab.click(),
      ready: () => historyReady(page),
    });

    const total = await reportTotal(page).catch(() => null);
    const term = await firstHistoryTerm(page);
    const search = page.getByPlaceholder(SEARCH_INPUT);

    if (term) {
      await measure("search records history by patient name", {
        kind: "interaction",
        action: () => search.fill(term),
        ready: () =>
          page.waitForFunction(
            (needle) => {
              const names = [...document.querySelectorAll("h3.font-extrabold")];
              return names.length > 0 && names.every((h) => h.textContent.toLowerCase().includes(needle.toLowerCase()));
            },
            term,
          ),
      });

      if (total) {
        await measure("clear records history search", {
          kind: "interaction",
          action: () => search.fill(""),
          ready: () => page.getByText(total, { exact: true }).first().waitFor({ state: "visible" }),
        });
      }
    }

    // History is usually the longer list. Scroll it to its last report.
    if ((await page.locator("main h3.font-extrabold").count()) > 1) {
      await measure("scroll records history to its last report", {
        kind: "scroll",
        action: async () => {
          const box = await page.locator("main").boundingBox();
          if (!box) return;
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.wheel(0, 100_000);
        },
        ready: () =>
          page.waitForFunction(() => {
            const names = document.querySelectorAll("main h3.font-extrabold");
            const last = names[names.length - 1];
            const main = document.querySelector("main");
            if (!last || !main) return false;
            const row = last.getBoundingClientRect();
            const area = main.getBoundingClientRect();
            return row.top >= area.top && row.bottom <= area.bottom + 1;
          }),
      });
    }

    await measure("switch to Open Queue tab", {
      kind: "interaction",
      action: () => queueTab.click(),
      ready: () => page.getByText(QUEUE_EMPTY_OR_ENTRY).first().waitFor({ state: "visible" }),
    });

    // Scroll the queue to its last entry, when the queue has entries.
    const entries = page.locator("a[href^='/department/records/entry/']");
    if ((await entries.count()) > 0) {
      await measure("scroll the open queue to its last entry", {
        kind: "scroll",
        action: async () => {
          const box = await page.locator("main").boundingBox();
          if (!box) return;
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.wheel(0, 100_000);
        },
        ready: () =>
          page.waitForFunction(() => {
            const entriesNow = document.querySelectorAll("a[href^='/department/records/entry/']");
            const last = entriesNow[entriesNow.length - 1];
            const main = document.querySelector("main");
            if (!last || !main) return false;
            const row = last.getBoundingClientRect();
            const area = main.getBoundingClientRect();
            return row.top >= area.top && row.bottom <= area.bottom + 1;
          }),
      });
    }

    if (patientId) {
      await page.goto(url("/profile"), { waitUntil: "load" });

      await measure("hard load record entry for the throwaway patient", {
        kind: "hard-load",
        action: () => page.goto(url(`/department/records/entry/${patientId}?department=laboratory`), { waitUntil: "commit" }),
        ready: async () => {
          await page.getByText(`Patient ID: ${patientId.slice(0, 8)}`).first().waitFor({ state: "visible" });
          await page.locator("form").first().waitFor({ state: "visible" });
        },
      });

      await measure("sidebar record entry -> Dept Records", {
        kind: "navigation",
        action: () => clickSidebar(page, "Dept Records"),
        ready: () => recordsReady(page),
      });
    }
  },
};
