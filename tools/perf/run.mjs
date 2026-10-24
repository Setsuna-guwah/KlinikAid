#!/usr/bin/env node
/**
 * KlinikAid user-action benchmark.
 *
 *   node tools/perf/run.mjs [--base https://www.klinikaid.com] [--accounts FILE]
 *        [--iterations 5] [--only name,name] [--out DIR] [--label TEXT] [--headed]
 *
 * Runs every scenario in tools/perf/scenarios/ (or the --only subset), each in
 * its own browser context, and writes one JSON result file. Render it with
 * tools/perf/report.mjs. See tools/perf/README.md.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { createMeasurer, instrument, login, stats } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {
    base: "https://www.klinikaid.com",
    accounts: process.env.PERF_ACCOUNTS ?? null,
    iterations: 5,
    only: null,
    out: path.join(os.homedir(), ".local/share/klinikaid-perf"),
    label: "",
    headed: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => argv[++i];
    if (flag === "--base") args.base = next();
    else if (flag === "--accounts") args.accounts = next();
    else if (flag === "--iterations") args.iterations = Number(next());
    else if (flag === "--only") args.only = next().split(",");
    else if (flag === "--out") args.out = next();
    else if (flag === "--label") args.label = next();
    else if (flag === "--headed") args.headed = true;
    else throw new Error(`unknown flag ${flag}`);
  }
  return args;
}

async function loadScenarios(only) {
  const dir = path.join(here, "scenarios");
  const files = fs.readdirSync(dir).filter((file) => file.endsWith(".mjs")).sort();
  const scenarios = [];
  for (const file of files) {
    const scenario = (await import(pathToFileURL(path.join(dir, file)).href)).default;
    if (!only || only.includes(scenario.name)) scenarios.push(scenario);
  }
  return scenarios;
}

function git(...args) {
  try {
    return execFileSync("git", args, { cwd: here, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

const args = parseArgs(process.argv.slice(2));
const accounts = args.accounts ? JSON.parse(fs.readFileSync(args.accounts, "utf8")) : {};
const scenarios = await loadScenarios(args.only);
if (scenarios.length === 0) throw new Error("no scenarios selected");

const probe = await fetch(new URL("/login", args.base));
const environment = {
  base: args.base,
  label: args.label,
  startedAt: new Date().toISOString(),
  harnessRevision: git("rev-parse", "--short", "HEAD"),
  vercelRoute: probe.headers.get("x-vercel-id")?.split("::").slice(0, -1).join("::") ?? null,
  host: os.hostname(),
  iterations: args.iterations,
  viewport: { width: 1366, height: 768 },
};

const browser = await chromium.launch({
  headless: !args.headed,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});
const samples = [];
const failures = [];

try {
  for (const scenario of scenarios) {
    const account = scenario.role === "anonymous" ? null : accounts[scenario.role];
    if (scenario.role !== "anonymous" && !account) {
      failures.push({ scenario: scenario.name, error: `no ${scenario.role} account in --accounts` });
      console.error(`skip ${scenario.name}: no ${scenario.role} account`);
      continue;
    }
    const context = await browser.newContext({ viewport: environment.viewport });
    await instrument(context);
    const page = await context.newPage();
    const state = {};
    try {
      if (account) {
        const sample = await login(page, createMeasurer(page, samples, { scenario: scenario.name, iteration: 0 }), args.base, account, scenario.landing);
        if (!sample.ok) throw new Error(`login failed: ${sample.error}`);
      }
      await scenario.setup?.({ page, context, baseURL: args.base, account, state });
      for (let iteration = 1; iteration <= (scenario.iterations ?? args.iterations); iteration += 1) {
        const measure = createMeasurer(page, samples, { scenario: scenario.name, iteration });
        try {
          await scenario.run({ page, context, measure, baseURL: args.base, account, state, iteration });
        } catch (error) {
          failures.push({ scenario: scenario.name, iteration, error: String(error?.message ?? error).split("\n")[0] });
        }
        console.error(`${scenario.name} #${iteration} done`);
      }
    } catch (error) {
      failures.push({ scenario: scenario.name, error: String(error?.message ?? error).split("\n")[0] });
    } finally {
      try {
        await scenario.cleanup?.({ page, context, baseURL: args.base, account, state });
      } catch (error) {
        failures.push({ scenario: scenario.name, phase: "cleanup", error: String(error?.message ?? error) });
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
}

const groups = new Map();
for (const sample of samples) {
  const key = `${sample.scenario}\u0000${sample.name}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(sample);
}
const summary = [...groups.values()].map((group) => {
  const ok = group.filter((sample) => sample.ok);
  const metric = (field) => stats(ok.map((sample) => sample[field]));
  return {
    scenario: group[0].scenario,
    name: group[0].name,
    kind: group[0].kind,
    samples: group.length,
    failed: group.length - ok.length,
    errors: [...new Set(group.filter((sample) => !sample.ok).map((sample) => sample.error))],
    ready: metric("ready"),
    settled: metric("settled"),
    feedback: metric("feedback"),
    feedbackSeen: ok.filter((sample) => sample.feedback !== null).length,
    rscTtfb: metric("rscTtfb"),
    requests: metric("requests"),
    transferKB: metric("transferKB"),
    longTaskMs: metric("longTaskMs"),
    maxEventMs: metric("maxEventMs"),
    cls: { max: Math.max(0, ...ok.map((sample) => sample.cls ?? 0)) },
    lcp: metric("lcp"),
    docTtfb: metric("docTtfb"),
  };
});

fs.mkdirSync(args.out, { recursive: true, mode: 0o700 });
const stamp = environment.startedAt.replace(/[:.]/g, "-");
const file = path.join(args.out, `perf-${stamp}${args.label ? `-${args.label.replace(/\W+/g, "_")}` : ""}.json`);
fs.writeFileSync(file, JSON.stringify({ environment, summary, failures, samples }, null, 2));
console.log(JSON.stringify({ result: file, actions: summary.length, failedSamples: samples.filter((s) => !s.ok).length, failures: failures.length }));
process.exitCode = failures.length || samples.some((sample) => !sample.ok) ? 1 : 0;
