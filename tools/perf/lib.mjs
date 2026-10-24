import crypto from "node:crypto";

/**
 * Shared measurement primitives for the KlinikAid performance benchmark.
 *
 * Every number the benchmark reports comes from `measure()` below, so every
 * scenario times the same things the same way. See tools/perf/README.md for
 * the metric definitions.
 */

/** Selectors that mean "the page is not finished yet". */
export const PENDING_SELECTORS = [
  ".animate-pulse",
  "[data-testid='navigation-progress']",
  "[aria-busy='true']",
];

/** Selectors that count as visible feedback that the click registered. */
export const FEEDBACK_SELECTORS = [
  "[data-testid='navigation-progress']",
  "[data-testid='sidebar-link-pending']",
  ".animate-pulse",
  "[aria-busy='true']",
  "button[disabled] svg.animate-spin",
  "svg.animate-spin",
];

/**
 * Installed in every page before any app script runs. It keeps the browser's
 * own performance entries (long tasks, event timing, LCP, layout shifts) so
 * `measure()` can read the ones that fall inside an action's window.
 */
function collector() {
  const store = { longtasks: [], events: [], lcp: [], shifts: [], frames: [] };
  window.__perf = store;
  // Frames that took longer than two vsyncs: what a user sees as a stutter.
  let last = null;
  const frame = (now) => {
    if (last !== null && now - last > 34) store.frames.push({ start: last, duration: now - last });
    last = now;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  const observe = (type, push, extra = {}) => {
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) push(entry);
      }).observe({ type, buffered: true, ...extra });
    } catch {
      // Entry type not supported by this browser; the metric stays empty.
    }
  };
  observe("longtask", (e) => store.longtasks.push({ start: e.startTime, duration: e.duration }));
  observe(
    "event",
    (e) => store.events.push({ start: e.startTime, duration: e.duration, name: e.name }),
    { durationThreshold: 16 },
  );
  observe("largest-contentful-paint", (e) => store.lcp.push({ start: e.startTime }));
  observe("layout-shift", (e) => {
    if (!e.hadRecentInput) store.shifts.push({ start: e.startTime, value: e.value });
  });
}

export async function instrument(context) {
  await context.addInitScript(collector);
}

/** RFC 6238 TOTP, the same algorithm the e2e specs use. */
export function totp(secret, at = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.replace(/[\s=]/g, "").toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index === -1) throw new Error("not a base32 secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const key = Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const hash = crypto.createHmac("sha1", key).update(counter).digest();
  const offset = hash[hash.length - 1] & 0xf;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1e6).padStart(6, "0");
}

const usedWindows = new Map();

/** A code from a 30-second window this process has not used for `secret`. */
export async function freshCode(secret) {
  for (;;) {
    const now = Date.now();
    const window = Math.floor(now / 30000);
    const secondsLeft = 30 - (Math.floor(now / 1000) % 30);
    if (usedWindows.get(secret) !== window && secondsLeft >= 8) {
      usedWindows.set(secret, window);
      return totp(secret, now);
    }
    await new Promise((resolve) => setTimeout(resolve, (secondsLeft + 1) * 1000));
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

/** Median, p75, min, max and the first (cold) sample of a list of numbers. */
export function stats(values) {
  const present = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  const sorted = [...present].sort((a, b) => a - b);
  const round = (value) => (value === null ? null : Math.round(value));
  return {
    n: present.length,
    first: round(present[0] ?? null),
    median: round(percentile(sorted, 50)),
    p75: round(percentile(sorted, 75)),
    min: round(sorted[0] ?? null),
    max: round(sorted[sorted.length - 1] ?? null),
  };
}

/**
 * Creates the `measure` function a scenario uses for one page.
 *
 * measure(name, options) runs `options.action()` and times it:
 *
 *  - `kind`: "hard-load" (a full document load), "navigation" (a client-side
 *    route change), "interaction" (a click, type or submit that stays on the
 *    page), "scroll", or "upload". Used to group the report and the budgets.
 *  - `action`: async () => void. Start the user action here (click, goto,
 *    setInputFiles...). The clock starts immediately before it.
 *  - `ready`: async () => void. Resolve once the content the user came for is
 *    on screen -- a real row, heading or value, never a skeleton. Required.
 *  - `settle`: also wait until no PENDING_SELECTORS element is visible
 *    (default true). Set false when the page legitimately keeps a spinner.
 *  - `timeout`: ms before the action counts as failed (default 30 s).
 *
 * It returns and records one sample:
 *   ready      click -> requested content visible (the headline number)
 *   settled    click -> no skeleton or progress indicator left
 *   feedback   click -> first visible feedback (progress bar, skeleton,
 *              spinner), or null if none appeared before content did
 *   rscTtfb    server wait of the slowest RSC / server-action request
 *   requests, transferKB   network activity inside the window
 *   longTasks, longTaskMs, maxEventMs (INP proxy), cls, lcp (hard loads),
 *   slowFrames, maxFrameMs (frames over 34 ms: stutter; the scroll metric),
 *   docTtfb, domContentLoaded (hard loads)
 */
export function createMeasurer(page, samples, { scenario, iteration }) {
  return async function measure(name, options) {
    const { kind, action, ready, settle = true, timeout = 30_000 } = options;
    if (!kind || !action || !ready) throw new Error(`measure(${name}): kind, action and ready are required`);

    const requests = [];
    const onRequest = (request) => requests.push(request);
    page.on("request", onRequest);

    const mark = await page.evaluate(() => performance.now()).catch(() => null);
    const origin = await page.evaluate(() => performance.timeOrigin).catch(() => null);

    let feedbackAt = null;
    let readyAt = null;
    const start = performance.now();
    const feedbackWatch = page
      .waitForSelector(FEEDBACK_SELECTORS.join(", "), { state: "visible", timeout })
      .then(() => {
        feedbackAt ??= performance.now();
      })
      .catch(() => {});

    const sample = { scenario, iteration, name, kind, ok: true };
    try {
      await action();
      await ready();
      readyAt = performance.now();
      if (settle) {
        await page.waitForFunction(
          (selectors) =>
            !selectors.some((selector) =>
              Array.from(document.querySelectorAll(selector)).some((element) => {
                const rect = element.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
              }),
            ),
          PENDING_SELECTORS,
          { timeout, polling: "raf" },
        );
      }
    } catch (error) {
      sample.ok = false;
      sample.error = String(error?.message ?? error).split("\n")[0];
    }
    const end = performance.now();
    page.off("request", onRequest);
    // A feedback element that only appeared after the content does not count.
    if (feedbackAt !== null && readyAt !== null && feedbackAt > readyAt) feedbackAt = null;
    void feedbackWatch;

    sample.ready = readyAt === null ? null : readyAt - start;
    sample.settled = sample.ok ? end - start : null;
    sample.feedback = feedbackAt === null ? null : feedbackAt - start;

    let transfer = 0;
    let rscTtfb = null;
    let rscCount = 0;
    // Next keeps link prefetches open, and Playwright's response()/sizes()
    // wait for completion, so every wait is bounded.
    const within = (promise, ms = 1500) =>
      Promise.race([promise.catch(() => null), new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
    for (const request of requests) {
      const response = await within(request.response());
      if (!response) continue;
      const sizes = await within(request.sizes(), 500);
      if (sizes) transfer += sizes.responseBodySize + sizes.responseHeadersSize;
      const headers = request.headers();
      const isRsc = request.url().includes("_rsc=") || headers["rsc"] === "1" || Boolean(headers["next-action"]);
      if (isRsc) {
        rscCount += 1;
        const timing = request.timing();
        if (timing.responseStart > 0) {
          const wait = timing.responseStart - Math.max(timing.requestStart, 0);
          rscTtfb = Math.max(rscTtfb ?? 0, wait);
        }
      }
    }
    sample.requests = requests.length;
    sample.rscRequests = rscCount;
    sample.rscTtfb = rscTtfb;
    sample.transferKB = Math.round(transfer / 1024);

    const browserSide = await page
      .evaluate(
        ({ mark, origin }) => {
          const store = window.__perf ?? { longtasks: [], events: [], lcp: [], shifts: [], frames: [] };
          // A hard load replaces the document, so everything in it is ours.
          const since = performance.timeOrigin === origin && mark !== null ? mark : 0;
          const inWindow = (list) => list.filter((entry) => entry.start >= since);
          const longtasks = inWindow(store.longtasks);
          const nav = performance.getEntriesByType("navigation")[0];
          const fresh = since === 0;
          return {
            longTasks: longtasks.length,
            longTaskMs: longtasks.reduce((sum, entry) => sum + entry.duration, 0),
            maxEventMs: Math.max(0, ...inWindow(store.events).map((entry) => entry.duration)),
            slowFrames: inWindow(store.frames).length,
            maxFrameMs: Math.max(0, ...inWindow(store.frames).map((entry) => entry.duration)),
            cls: inWindow(store.shifts).reduce((sum, entry) => sum + entry.value, 0),
            lcp: fresh ? (store.lcp.at(-1)?.start ?? null) : null,
            docTtfb: fresh && nav ? nav.responseStart - nav.requestStart : null,
            domContentLoaded: fresh && nav ? nav.domContentLoadedEventEnd : null,
          };
        },
        { mark, origin },
      )
      .catch(() => ({}));
    Object.assign(sample, browserSide);
    sample.cls = typeof sample.cls === "number" ? Math.round(sample.cls * 1000) / 1000 : null;

    samples.push(sample);
    return sample;
  };
}

/**
 * Signs in through the real login form and records it as a measurement.
 * `account` is { email, password, mfaSecret? }. Staff accounts are MFA-gated.
 */
export async function login(page, measure, baseURL, account, landing) {
  await page.goto(new URL("/login", baseURL).href);
  await page.fill("#email", account.email);
  await page.fill("#password", account.password);
  // Fetch the code first: waiting for a fresh TOTP window is not app time.
  const code = account.mfaSecret ? await freshCode(account.mfaSecret) : null;
  return measure("login: submit -> landing page ready", {
    kind: "navigation",
    action: async () => {
      await page.click('button[type="submit"]');
      if (code) {
        await page.waitForSelector("#totpCode", { timeout: 30_000 });
        await page.fill("#totpCode", code);
        await page.click('button[type="submit"]');
      }
    },
    ready: async () => {
      await page.waitForURL(landing, { timeout: 30_000 });
      await page.waitForSelector("main h1, main h2", { state: "visible" });
    },
  });
}

/** Clicks the sidebar link with this exact label. */
export async function clickSidebar(page, label) {
  await page.locator("aside nav a").filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).first().click();
}
