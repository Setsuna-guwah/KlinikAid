# PR verification

Run `npm ci`, then `npx playwright install --with-deps --only-shell chromium`
once per installed Playwright version. Run `npm run verify` before handing a
change back. It runs typecheck, lint, unit tests, configuration tests, production
build and anonymous browser checks in order, stopping at the first failed gate.
Each gate writes a log and the command reports a JSON receipt path.

The browser checks start and stop their own built app on 127.0.0.1:3098.
Parallel workers need separate worktrees and available ports: set `VERIFY_PORT`
to select another port instead of replacing an existing server. Build before running `npm run test:browser`
alone. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select an existing local browser.

PRs to master run this same command in GitHub Actions, including draft PRs.
An updated commit cancels the obsolete run. The stable `Merge readiness` check
fails if verification fails, is cancelled, or is skipped. Failed runs retain logs,
screenshots and traces for seven days. CI uses placeholder configuration and
anonymous browser contexts; no production credentials or account writes are needed.

Create a draft PR for worker output. Fix deterministic failures before requesting
lead or human acceptance review. Reuse the successful CI run for its tested
revision; the lead reviews the outcome and issue-specific evidence. Keep PR
follow-ups manual unless the human requests automatic monitoring.

Green CI means the declared checks passed, not that every requirement is proven.
Add assertions for the task's acceptance criteria and meaningful negative cases.
Changes involving signed-in roles or data still need their specific isolated
fixtures, permission checks and cleanup. CodeRabbit provides additional review;
it does not replace these tests or a final acceptance decision. This workflow
does not deploy the application or automatically merge PRs.
