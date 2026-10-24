# User-action benchmark

Times what a user actually waits for on KlinikAid: a click, a page load, a
search, an upload or a scroll, from the input to the content they came for
being on screen. It is the definition of "faster" for the performance issues
(label `performance`). The budgets, baseline and progress log live outside git
in `/home/jonkler/code/Klinikaid/private/performance/PERFORMANCE.md`
(`private/` is gitignored and this repository is public); GitHub issues carry
only the per-action numbers each fix is judged by.

## Run it

```bash
# Signed-out pages only, no accounts needed
node tools/perf/run.mjs --iterations 5 --label anon --only anonymous

# Everything, against production, with throwaway accounts
node tools/perf/run.mjs --accounts /tmp/perf-accounts.json --iterations 5 --label baseline

# Render one run, or compare two
node tools/perf/report.mjs ~/.local/share/klinikaid-perf/perf-<stamp>.json
node tools/perf/report.mjs BEFORE.json AFTER.json
```

- `--base` defaults to `https://www.klinikaid.com`. A local production build
  (`npm run build && npm run start -- -p 3105`) works too, but only compare runs
  that share a base URL, host and Vercel route (the report prints all three).
- `--accounts` is a mode-600 JSON file mapping role to
  `{ "email", "password", "mfaSecret" }`, made from throwaway accounts
  (`~/.agents/skills/verify-and-report/scripts/e2e-account.mjs create <role> --mfa`).
  Never commit it. Roles: `admin`, `receptionist`, `department_staff`,
  `medical_specialist`, `patient`. Scenarios whose role is missing are skipped
  and reported as failures, so a partial run is never mistaken for a full one.
- Results go to `~/.local/share/klinikaid-perf/` (outside the repo). Copy the
  summary table into `private/performance/PERFORMANCE.md` when it marks progress.
- `--profile mobile-4g` emulates a mid-range phone on a Philippine mobile
  network (150 ms extra RTT, 9 Mbps down, 4x CPU slowdown). Only compare runs
  with the same profile.
- The exit code is 1 if any action failed or any scenario was skipped.

## What is measured

Every number comes from `measure()` in `lib.mjs`:

| Field | Meaning |
|---|---|
| `ready` | **The headline number.** Input → the requested content visible (a real row, heading or value, never a skeleton). |
| `settled` | Input → no skeleton, progress bar or `aria-busy` left on screen. |
| `feedback` | Input → first visible response (progress bar, skeleton, spinner). Empty when the content arrived first. |
| `rscTtfb` | Server wait of the slowest RSC or server-action request in the window. |
| `requests`, `transferKB` | Network activity inside the window (warm HTTP cache after the first iteration). |
| `longTaskMs`, `maxEventMs` | Main-thread long tasks and the slowest input event (an INP proxy). |
| `lcp`, `docTtfb`, `cls` | Hard loads only: Largest Contentful Paint, document TTFB, layout shift. |

Each scenario runs `--iterations` times in one signed-in browser context; the
report shows the median, p75 and the first (cold) sample. Iteration 0 is the
login itself.

## Writing a scenario

A file in `scenarios/` exports:

```js
export default {
  name: "admin",                 // used by --only and in the report
  role: "admin",                 // key into the accounts file, or "anonymous"
  landing: /\/admin\/dashboard/, // where login lands
  iterations: 3,                 // optional override (costly actions)
  async setup({ page, state }) {},   // optional, once after login
  async run({ page, measure, baseURL, state, iteration }) {
    await measure("sidebar Dashboard -> Staff Management", {
      kind: "navigation",
      action: () => clickSidebar(page, "Staff Management"),
      ready: () => page.getByRole("table").locator("tbody tr").first().waitFor(),
    });
  },
  async cleanup({ state }) {},       // optional, always runs
};
```

Rules:

- Name actions the way a user would describe them, and keep names stable:
  the comparison report matches actions by scenario and name.
- `ready` must wait for real content. Waiting for a heading the skeleton also
  renders measures nothing.
- Read-only by default. An action that writes (an upload, a form submission)
  may only touch data the throwaway account owns, and `cleanup` must remove it.
  Never approve, route, edit or delete real patients' data, and never upload
  to the shared RAG index.
