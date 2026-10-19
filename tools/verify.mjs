// The same ordered gates are used locally and by CI. Output is intentionally bounded.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "klinikaid-verify-"));
const env = {
  ...process.env,
  CI: "true",
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder",
};
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const results = [];
let passed = true;
const gates = ["typecheck", "lint", "test", "build"];
if (process.argv.includes("--install-browser")) gates.push("browser:install");
gates.push("test:browser");
for (const gate of gates) {
  const log = join(directory, gate.replaceAll(":", "-") + ".log");
  const descriptor = openSync(log, "w", 0o600);
  const start = Date.now();
  const args = gate === "browser:install"
    ? ["exec", "--no", "--", "playwright", "install", "--with-deps", "--only-shell", "chromium"]
    : ["run", gate];
  const result = spawnSync(npm, args, { env, stdio: ["ignore", descriptor, descriptor], shell: process.platform === "win32" });
  closeSync(descriptor);
  const success = !result.error && result.status === 0;
  results.push({ gate, passed: success, exitCode: result.status, durationMs: Date.now() - start, log });
  console.log(`${success ? "PASS" : "FAIL"} ${gate}: ${log}`);
  if (!success) {
    passed = false;
    console.error(result.error?.message || readFileSync(log, "utf8").slice(-4000));
    break;
  }
}
const status = spawnSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { encoding: "buffer" });
const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
const report = { passed, commit: head.status === 0 ? head.stdout.trim() : null, dirty: status.status === 0 ? status.stdout.length > 0 : null, gates: results };
const receipt = join(directory, "result.json");
writeFileSync(receipt, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
console.log(`Receipt: ${receipt}`);
process.exitCode = passed ? 0 : 1;
