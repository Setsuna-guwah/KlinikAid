#!/usr/bin/env node
/**
 * Renders benchmark results as Markdown.
 *
 *   node tools/perf/report.mjs RESULT.json                 one run, with budgets
 *   node tools/perf/report.mjs BASELINE.json CURRENT.json  before -> after
 *
 * Several result files can be merged into one run with commas:
 *   node tools/perf/report.mjs a.json,b.json
 *
 * Budgets live in tools/perf/budgets.json, keyed by action kind. An action
 * passes when its median `ready` time is within its kind's budget and, for
 * navigations, visible feedback appeared within the feedback budget.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const budgets = JSON.parse(fs.readFileSync(path.join(here, "budgets.json"), "utf8"));

function load(spec) {
  const runs = spec.split(",").map((file) => JSON.parse(fs.readFileSync(file, "utf8")));
  return {
    environment: runs[0].environment,
    summary: runs.flatMap((run) => run.summary),
    failures: runs.flatMap((run) => run.failures),
  };
}

const key = (row) => `${row.scenario} | ${row.name}`;
const ms = (value) => (value === null || value === undefined ? "–" : `${value}`);

function verdict(row) {
  const budget = budgets.ready[row.kind];
  if (row.failed === row.samples) return "FAIL (error)";
  if (budget === undefined || row.ready.median === null) return "–";
  const fast = row.ready.median <= budget;
  const feedbackBudget = budgets.feedback[row.kind];
  // Feedback only matters when the content itself is not already on screen.
  const needsFeedback = feedbackBudget !== undefined && row.ready.median > feedbackBudget;
  const fed = !needsFeedback || (row.feedback.median !== null && row.feedback.median <= feedbackBudget);
  if (fast && fed) return "pass";
  return [fast ? null : `over ${budget}`, fed ? null : "no feedback"].filter(Boolean).join(", ");
}

const [first, second] = process.argv.slice(2);
if (!first) {
  console.error("usage: report.mjs RESULT.json [CURRENT.json]");
  process.exit(2);
}

const base = load(first);
const lines = [];
const env = base.environment;
lines.push(`Run: ${env.startedAt} · ${env.base} · route ${env.vercelRoute ?? "?"} · host ${env.host} · ${env.iterations} iterations · harness ${env.harnessRevision}`);
lines.push("");

if (!second) {
  lines.push("| Scenario | Action | Kind | Ready median (ms) | p75 | first | Feedback median | RSC TTFB | Requests | KB | Long tasks ms | Verdict |");
  lines.push("|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|");
  for (const row of base.summary) {
    lines.push(
      `| ${row.scenario} | ${row.name} | ${row.kind} | ${ms(row.ready.median)} | ${ms(row.ready.p75)} | ${ms(row.ready.first)} | ${ms(row.feedback.median)} | ${ms(row.rscTtfb.median)} | ${ms(row.requests.median)} | ${ms(row.transferKB.median)} | ${ms(row.longTaskMs.median)} | ${verdict(row)} |`,
    );
  }
} else {
  const current = load(second);
  const after = new Map(current.summary.map((row) => [key(row), row]));
  lines.push(`After: ${current.environment.startedAt} · route ${current.environment.vercelRoute ?? "?"} · harness ${current.environment.harnessRevision}`);
  lines.push("");
  lines.push("| Scenario | Action | Ready median before → after (ms) | Δ | p75 before → after | Feedback before → after | Verdict after |");
  lines.push("|---|---|---|---:|---|---|---|");
  for (const row of base.summary) {
    const next = after.get(key(row));
    if (!next) {
      lines.push(`| ${row.scenario} | ${row.name} | ${ms(row.ready.median)} → (not run) | | | | |`);
      continue;
    }
    const delta =
      row.ready.median !== null && next.ready.median !== null
        ? `${Math.round(((next.ready.median - row.ready.median) / row.ready.median) * 100)}%`
        : "–";
    lines.push(
      `| ${row.scenario} | ${row.name} | ${ms(row.ready.median)} → ${ms(next.ready.median)} | ${delta} | ${ms(row.ready.p75)} → ${ms(next.ready.p75)} | ${ms(row.feedback.median)} → ${ms(next.feedback.median)} | ${verdict(next)} |`,
    );
  }
}

const failures = base.failures;
if (failures.length) {
  lines.push("");
  lines.push("Failures:");
  for (const failure of failures) lines.push(`- ${failure.scenario}${failure.iteration ? ` #${failure.iteration}` : ""}: ${failure.error}`);
}
console.log(lines.join("\n"));
