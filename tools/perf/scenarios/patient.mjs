/**
 * Patient portal: the waits a signed-in patient feels. Walks the sidebar and
 * hard-loads every page, uploads one throwaway lab request and asks the
 * assistant two questions. Only the disposable patient account writes data,
 * and cleanup cancels each pending submission through the app's own button.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clickSidebar } from "../lib.mjs";

const UPLOAD_TIMEOUT = 90_000;
const DOCUMENT_ID = /"documentId":"([0-9a-f-]{36})"/;
const CHAT_PLACEHOLDER = /^Ask about operating hours/;
// Assistant replies are the only <p> inside a rounded-tl bubble. The loading
// bubble has no <p>, and user bubbles use rounded-tr.
const CHAT_REPLIES = ".rounded-tl-none > p";

// The results empty state keeps a decorative animate-pulse icon on screen, which
// lib.mjs's settle check reads as "still loading" and would wait on forever.
const RESULTS_SETTLE = false;

// Each entry resolves once that page's real content is on screen. None of
// them match a heading or label that the route's loading.tsx also renders.
const READY = {
  dashboard: (page) => page.getByRole("heading", { name: /^Welcome,/ }).waitFor({ state: "visible" }),
  submit: (page) => page.getByText("File Upload Portal", { exact: true }).waitFor({ state: "visible" }),
  submissions: (page) =>
    page.getByRole("heading", { name: "Track Submissions", exact: true }).waitFor({ state: "visible" }),
  results: async (page) => {
    await page.getByRole("heading", { name: "My Results", exact: true }).waitFor({ state: "visible" });
    await page
      .getByText("No medical records found")
      .or(page.getByText("Results Released:"))
      .first()
      .waitFor({ state: "visible" });
  },
  templates: (page) =>
    page.getByRole("heading", { name: "Document Templates", exact: true }).waitFor({ state: "visible" }),
  chat: (page) => page.getByText("Hello! I am your KlinikAid AI assistant").waitFor({ state: "visible" }),
  profile: (page) => page.getByRole("heading", { name: "Account Settings", exact: true }).waitFor({ state: "visible" }),
};

/** A one-page PDF with real text, so the OCR step has something to read. */
function writePdf(file, lines) {
  const content = [
    "BT",
    "/F1 12 Tf",
    "72 720 Td",
    ...lines.flatMap((line, index) => (index === 0 ? [`(${line}) Tj`] : ["0 -18 Td", `(${line}) Tj`])),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  fs.writeFileSync(file, Buffer.from(pdf, "latin1"), { mode: 0o600 });
}

/**
 * Submits the lab request and answers whichever confirmation the form asks
 * for: a text-extraction warning, a no-tests warning, or the detected-tests
 * checklist. Each of those is an extra click the patient makes.
 */
async function submitLabRequest(page) {
  await page.getByRole("button", { name: "Submit Lab Request", exact: true }).click();
  const confirm = page.getByRole("button", { name: /^Submit (Anyway|Selected Tests)$/ });
  const submitting = page.getByRole("button", { name: /^Submitting/ });
  const success = page.getByText("Document Submitted Successfully", { exact: true });
  const failure = page.getByText("Upload Failed", { exact: true });

  for (let step = 0; step < 3; step += 1) {
    await confirm.or(success).or(failure).first().waitFor({ state: "visible", timeout: UPLOAD_TIMEOUT });
    if (await success.isVisible()) return;
    if (await failure.isVisible()) {
      const detail = await page.getByRole("alert").first().innerText().catch(() => "");
      throw new Error(`submission rejected: ${detail.split("\n").join(" ").slice(0, 160)}`);
    }
    await confirm.first().click();
    await submitting.or(success).or(failure).first().waitFor({ state: "visible", timeout: UPLOAD_TIMEOUT });
  }
  await success.waitFor({ state: "visible", timeout: UPLOAD_TIMEOUT });
}

/** Collects the documentId each confirmation server action returns. */
function recordDocumentIds(page, state) {
  const reads = [];
  const onResponse = (response) => {
    if (!response.request().headers()["next-action"]) return;
    reads.push(
      response
        .text()
        .then((text) => {
          const match = text.match(DOCUMENT_ID);
          if (match) state.documentIds.push(match[1]);
        })
        .catch(() => {}),
    );
  };
  page.on("response", onResponse);
  return async () => {
    page.off("response", onResponse);
    await Promise.all(reads);
  };
}

/**
 * Cancels every pending submission on Track Submission through the app's own
 * "Cancel" button, which also removes the stored file. The duplicate-pending
 * rule allows one pending document per category, so the upload step needs
 * this to start clean.
 */
async function cancelPendingSubmissions(page) {
  await clickSidebar(page, "Track Submission");
  await READY.submissions(page);
  for (let round = 0; round < 10; round += 1) {
    const cancel = page.getByRole("button", { name: "Cancel", exact: true });
    const count = await cancel.count();
    if (count === 0) return;
    await cancel.first().click();
    await page.getByRole("button", { name: "Cancel Submission", exact: true }).click();
    await page.waitForFunction(
      (before) => [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === "Cancel").length < before,
      count,
      { polling: "raf" },
    );
  }
  throw new Error("pending submissions still present after 10 cancellations");
}

export default {
  name: "patient",
  role: "patient",
  landing: /\/patient\/dashboard/,
  iterations: 3,

  async setup({ state }) {
    state.documentIds = [];
  },

  async run({ page, measure, baseURL, state, iteration }) {
    const url = (route) => new URL(route, baseURL).href;

    await measure("hard load /patient/dashboard", {
      kind: "hard-load",
      action: () => page.goto(url("/patient/dashboard"), { waitUntil: "commit" }),
      ready: () => READY.dashboard(page),
    });

    // Starts on the dashboard the hard load just opened, so the walk begins at Submit.
    const walk = [
      ["Submit Document", READY.submit],
      ["Track Submission", READY.submissions],
      ["My Results", READY.results, RESULTS_SETTLE],
      ["Document Templates", READY.templates],
      ["AI Assistant", READY.chat],
      ["Dashboard", READY.dashboard],
    ];
    for (const [label, ready, settle = true] of walk) {
      await measure(`sidebar ${label}`, {
        kind: "navigation",
        action: () => clickSidebar(page, label),
        ready: () => ready(page),
        settle,
      });
    }

    const hardLoads = [
      ["/patient/dashboard", READY.dashboard],
      ["/patient/submit", READY.submit],
      ["/patient/submissions", READY.submissions],
      ["/patient/results", READY.results, RESULTS_SETTLE],
      ["/patient/templates", READY.templates],
      ["/patient/chat", READY.chat],
    ];
    for (const [route, ready, settle = true] of hardLoads) {
      await measure(`hard load ${route}`, {
        kind: "hard-load",
        action: () => page.goto(url(route), { waitUntil: "commit" }),
        ready: () => ready(page),
        settle,
      });
    }

    // Untimed setup: clear pending documents left by an earlier iteration.
    await cancelPendingSubmissions(page);
    await clickSidebar(page, "Submit Document");
    await READY.submit(page);

    const file = path.join(os.tmpdir(), `perf-patient-${process.pid}-${iteration}.pdf`);
    writePdf(file, ["KlinikAid perf benchmark", "Laboratory request", "Complete blood count"]);
    await measure("choose file -> filename shown", {
      kind: "interaction",
      action: () => page.locator("#file-upload").setInputFiles(file),
      ready: () => page.getByText(path.basename(file), { exact: true }).waitFor({ state: "visible" }),
    });

    await measure("submit document -> confirmation shown", {
      kind: "upload",
      action: async () => {
        const finish = recordDocumentIds(page, state);
        try {
          await submitLabRequest(page);
        } finally {
          await finish();
        }
      },
      ready: () => page.getByText("Document Submitted Successfully", { exact: true }).waitFor({ state: "visible" }),
    });
    fs.rmSync(file, { force: true });

    await clickSidebar(page, "AI Assistant");
    await READY.chat(page);
    const replies = () => page.locator(CHAT_REPLIES);
    let before = 0;

    await measure("send chat message -> first reply text visible", {
      kind: "interaction",
      action: async () => {
        before = await replies().count();
        await page.getByPlaceholder(CHAT_PLACEHOLDER).fill("What are the clinic hours?");
        await page.getByRole("button", { name: "Send message", exact: true }).click();
      },
      ready: () => replies().nth(before).waitFor({ state: "visible" }),
    });

    await measure("send chat message -> reply finished", {
      kind: "interaction",
      action: async () => {
        before = await replies().count();
        await page.getByPlaceholder(CHAT_PLACEHOLDER).fill("Do I need to fast before a blood test?");
        await page.getByRole("button", { name: "Send message", exact: true }).click();
      },
      ready: async () => {
        await replies().nth(before).waitFor({ state: "visible" });
        await page.getByText("AI is reading guidelines...").waitFor({ state: "detached" });
        await page.waitForFunction(() => {
          const input = document.querySelector('input[maxlength="1000"]');
          return Boolean(input) && !input.disabled;
        }, null, { polling: "raf" });
      },
    });

    await clickSidebar(page, "Document Templates");
    await READY.templates(page);
    await measure("open template Referral Form -> form shown", {
      kind: "interaction",
      action: () => page.getByRole("button", { name: "Open Referral Form", exact: true }).click(),
      ready: () =>
        page.getByRole("heading", { name: "Referral Form", exact: true, level: 1 }).waitFor({ state: "visible" }),
    });
    // Back to the grid without submitting: a template submit writes a record.
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Open Referral Form", exact: true }).waitFor({ state: "visible" });

    // The template grid is the longest list this account can see.
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, -5000);
    await measure("scroll template list -> last template visible", {
      kind: "scroll",
      action: async () => {
        await page.mouse.move(640, 400);
        await page.mouse.wheel(0, 5000);
      },
      ready: () =>
        page.waitForFunction(
          () => {
            const cards = document.querySelectorAll('button[aria-label^="Open "]');
            const last = cards[cards.length - 1];
            if (!last) return false;
            const rect = last.getBoundingClientRect();
            return rect.top >= 0 && rect.bottom <= window.innerHeight;
          },
          null,
          { polling: "raf" },
        ),
    });

    await measure("sidebar My Profile", {
      kind: "navigation",
      action: () => clickSidebar(page, "My Profile"),
      ready: async () => {
        await READY.profile(page);
        await page.getByText("Patient Details", { exact: true }).waitFor({ state: "visible" });
      },
    });
  },

  async cleanup({ page }) {
    if (page.isClosed()) return;
    await cancelPendingSubmissions(page);
  },
};
