#!/usr/bin/env node
/**
 * Throwaway accounts and fixture rows for a full benchmark run.
 *
 *   node tools/perf/fixtures.mjs create FILE   accounts + specialist fixture -> FILE (mode 600)
 *   node tools/perf/fixtures.mjs delete FILE   delete everything FILE lists, then FILE
 *
 * Run from a KlinikAid checkout root with `.env.local` and node_modules. It
 * drives the verify-and-report account helper, so every account carries the
 * e2e_throwaway tag and cleanup refuses anything else. FILE holds passwords and
 * MFA seeds: keep it outside the repo and never print it.
 *
 * After `create`, run the benchmark with:
 *   PERF_PATIENT_NAME=<FILE.env.PERF_PATIENT_NAME> PERF_PATIENT_ID=<FILE.env.PERF_PATIENT_ID> \
 *     node tools/perf/run.mjs --accounts FILE
 * (`run.mjs` ignores the extra keys.)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const HELPER = path.join(os.homedir(), ".agents/skills/verify-and-report/scripts/e2e-account.mjs");
const ROLES = [
  ["admin", ["--mfa"]],
  ["receptionist", ["--mfa"]],
  ["department_staff", ["--department", "laboratory", "--mfa"]],
  ["medical_specialist", ["--mfa"]],
  ["patient", []],
];
const SPECIALIST_LAST_NAME = "PerfThrowaway";

function helper(...args) {
  return execFileSync(process.execPath, [HELPER, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

function serviceClient() {
  const env = {};
  for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  const { createClient } = createRequire(path.join(process.cwd(), "package.json"))("@supabase/supabase-js");
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

async function create(file) {
  if (fs.existsSync(file)) throw new Error(`${file} exists; delete it first`);
  const out = { env: {}, fixtures: {} };
  const save = () => fs.writeFileSync(file, JSON.stringify(out, null, 2), { mode: 0o600 });
  save();
  for (const [role, flags] of ROLES) {
    const account = JSON.parse(helper("create", role, ...flags, "--label", "perf"));
    out[role] = { id: account.id, email: account.email, password: account.password, mfaSecret: account.mfaSecret ?? undefined, patientId: account.patientId ?? undefined };
    save();
    console.error(`created ${role} ${account.id}`);
  }
  out.env.PERF_PATIENT_ID = out.patient.patientId;

  // The specialist's own directory entry with a few records, so the analytics
  // chart has something to draw. Owned by the throwaway specialist, so
  // `delete --purge-owned` removes it.
  const supabase = serviceClient();
  const specialistId = out.medical_specialist.id;
  const { data: patient, error } = await supabase
    .from("specialist_patients")
    .insert({ specialist_id: specialistId, first_name: "Bench", last_name: SPECIALIST_LAST_NAME, date_of_birth: "1990-01-01", gender: "other" })
    .select("id")
    .single();
  if (error) throw error;
  out.fixtures.specialistPatientId = patient.id;
  save();
  const records = Array.from({ length: 5 }, (_, index) => ({
    specialist_patient_id: patient.id,
    specialist_id: specialistId,
    test_type: "laboratory",
    test_name: "Fasting Blood Sugar",
    test_value: String(90 + index * 4),
    unit: "mg/dL",
    reference_range_min: 70,
    reference_range_max: 100,
    is_flagged: 90 + index * 4 > 100,
    created_at: new Date(Date.now() - (5 - index) * 86_400_000).toISOString(),
  }));
  const { error: recordError } = await supabase.from("specialist_records").insert(records);
  if (recordError) throw recordError;
  out.env.PERF_PATIENT_NAME = SPECIALIST_LAST_NAME;
  save();
  console.error(`fixtures written to ${file}`);
}

function remove(file) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  let failed = false;
  for (const [role] of ROLES) {
    const account = data[role];
    if (!account?.id) continue;
    const args = ["delete", account.id, "--purge-owned"];
    if (account.patientId) args.push("--also", `patients:${account.patientId}`);
    try {
      helper(...args);
      console.error(`deleted ${role} ${account.id}`);
    } catch {
      failed = true;
      console.error(`FAILED to delete ${role} ${account.id}; retry this command`);
    }
  }
  const left = JSON.parse(helper("list"));
  const ids = new Set(ROLES.map(([role]) => data[role]?.id).filter(Boolean));
  const remaining = (Array.isArray(left) ? left : left.accounts ?? []).filter((account) => ids.has(account.id));
  if (failed || remaining.length) {
    console.error(`still present: ${remaining.map((account) => account.id).join(", ") || "(see errors above)"}`);
    process.exit(1);
  }
  fs.rmSync(file);
  console.error("all perf fixtures deleted");
}

const [command, file] = process.argv.slice(2);
if (!file || !["create", "delete"].includes(command)) {
  console.error("usage: fixtures.mjs create|delete FILE");
  process.exit(2);
}
if (command === "create") await create(file);
else remove(file);
