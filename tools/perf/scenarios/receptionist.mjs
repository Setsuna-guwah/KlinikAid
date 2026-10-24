/**
 * Receptionist (reception desk): dashboard, queue board, document detail.
 *
 * Read-only on real documents. It views the board and one document's detail
 * page, and searches and scrolls the board. It never approves, rejects, routes
 * or edits anything. No environment variables are needed.
 *
 * Note: Documents is not a sidebar item and `/reception/documents` redirects to
 * the queue board, so it is measured as a hard load only.
 */
import { clickSidebar } from "../lib.mjs";

const BOARD_STATUS = /^Showing \d+ loaded$/;
const SEARCH_STATUS = /^\d+ matches? across all records$/;
const SEARCH_INPUT = "input[aria-label='Search the queue']";
const UNKNOWN_PATIENT = "Unknown patient";

// KPI values only render with data, never in the pulsing skeleton.
const kpiReady = (page) =>
  page.waitForFunction(() =>
    [...document.querySelectorAll("main .text-3xl")].some((el) => /^\d+$/.test(el.textContent.trim())),
  );

// The board's status line is computed from the loaded documents.
const boardReady = (page) => page.getByText(BOARD_STATUS).first().waitFor({ state: "visible" });

const searchReady = (page) => page.getByText(SEARCH_STATUS).first().waitFor({ state: "visible" });

const completedReady = (page) =>
  page
    .locator(
      "section[aria-label^='Approved']:visible, div[title^='Approved:']:visible, " +
        "section[aria-label^='Rejected']:visible, div[title^='Rejected:']:visible",
    )
    .first()
    .waitFor({ state: "visible" });

/** The first card on the board that reception could open, or null. */
async function firstCard(page) {
  const link = page.locator("a[href^='/reception/queue/']:visible").first();
  if ((await link.count()) === 0) return null;
  const name = ((await link.locator("span.truncate").first().textContent()) ?? "").trim();
  return {
    link,
    href: await link.getAttribute("href"),
    fileName: (await link.locator("span.flex-1.truncate").first().getAttribute("title")) ?? "",
    // Last name token: short, and the server search matches patient names.
    term: name && name !== UNKNOWN_PATIENT ? name.split(/\s+/).at(-1) : null,
  };
}

/** The column with the most cards, as the viewport centre the wheel is sent to. */
const longestColumnCenter = () => {
  const boxes = [...document.querySelectorAll("section[aria-label$=' documents'] > div.overflow-y-auto")];
  const box = boxes.sort((a, b) => b.querySelectorAll("li").length - a.querySelectorAll("li").length)[0];
  if (!box) return null;
  const rect = box.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
};

export default {
  name: "receptionist",
  role: "receptionist",
  // Sign-in sends a receptionist (documents.manage + queue.manage) to the queue.
  landing: /\/reception\/(queue|dashboard)/,
  async run({ page, measure, baseURL }) {
    const url = (path) => new URL(path, baseURL).href;

    await measure("hard load Reception Dashboard", {
      kind: "hard-load",
      action: () => page.goto(url("/reception/dashboard"), { waitUntil: "commit" }),
      ready: () => kpiReady(page),
    });

    await measure("sidebar Reception Dashboard -> Reception Queue", {
      kind: "navigation",
      action: () => clickSidebar(page, "Reception Queue"),
      ready: () => boardReady(page),
    });

    await measure("sidebar Reception Queue -> Reception Dashboard", {
      kind: "navigation",
      action: () => clickSidebar(page, "Reception Dashboard"),
      ready: () => kpiReady(page),
    });

    await measure("hard load Reception Queue", {
      kind: "hard-load",
      action: () => page.goto(url("/reception/queue"), { waitUntil: "commit" }),
      ready: () => boardReady(page),
    });

    await measure("hard load Documents (redirects to queue)", {
      kind: "hard-load",
      action: () => page.goto(url("/reception/documents"), { waitUntil: "commit" }),
      ready: () => boardReady(page),
    });

    const card = await firstCard(page);

    if (card?.term) {
      await measure("search queue by patient name", {
        kind: "interaction",
        action: () => page.locator(SEARCH_INPUT).fill(card.term),
        ready: () => searchReady(page),
      });

      await measure("clear queue search", {
        kind: "interaction",
        action: () => page.locator(SEARCH_INPUT).fill(""),
        ready: () => boardReady(page),
      });
    }

    // Filter: the completed columns. Closed again afterwards without a sample,
    // so the next iteration starts from the same state.
    const completedToggle = page.getByRole("button", { name: /Recently completed/ });
    await measure("show Recently completed columns", {
      kind: "interaction",
      action: () => completedToggle.click(),
      ready: () => completedReady(page),
    });
    await completedToggle.click();
    await boardReady(page);

    if (card) {
      await measure("scroll the longest board column to its last card", {
        kind: "scroll",
        action: async () => {
          const center = await page.evaluate(longestColumnCenter);
          if (!center) return;
          await page.mouse.move(center.x, center.y);
          await page.mouse.wheel(0, 100_000);
        },
        ready: () =>
          page.waitForFunction(() => {
            const boxes = [...document.querySelectorAll("section[aria-label$=' documents'] > div.overflow-y-auto")];
            const box = boxes.sort((a, b) => b.querySelectorAll("li").length - a.querySelectorAll("li").length)[0];
            const last = box?.querySelector(":scope > ul > li:last-child");
            if (!last) return false;
            const row = last.getBoundingClientRect();
            const area = box.getBoundingClientRect();
            return row.top >= area.top && row.bottom <= area.bottom + 1;
          }),
      });
    }

    if (card) {
      await measure("open a queue document's detail (view only)", {
        kind: "navigation",
        action: () => card.link.click(),
        ready: () => page.getByText(card.fileName, { exact: true }).first().waitFor({ state: "visible" }),
      });

      await measure("back to the queue board", {
        kind: "navigation",
        action: () => page.goBack(),
        ready: () => boardReady(page),
      });

      // Leave the board unmeasured first. Its in-flight card prefetches never
      // answer, and measure() waits on every request in its window.
      await page.goto(url("/reception/dashboard"), { waitUntil: "load" });

      await measure("hard load a queue document's detail", {
        kind: "hard-load",
        action: () => page.goto(url(card.href), { waitUntil: "commit" }),
        ready: () => page.getByText(card.fileName, { exact: true }).first().waitFor({ state: "visible" }),
      });
    }
  },
};
