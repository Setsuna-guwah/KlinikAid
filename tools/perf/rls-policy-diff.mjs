#!/usr/bin/env node
/**
 * Proves that migration_43 only wraps RLS auth calls in initPlans (#235).
 *
 *   node tools/perf/rls-policy-diff.mjs --admin-url postgresql://postgres:PW@127.0.0.1:54235/postgres
 *   node tools/perf/rls-policy-diff.mjs --admin-url ... --live     (also compares production, read-only)
 *
 * --admin-url is a LOCAL throwaway Postgres with pgvector (the supabase/postgres image works). The
 * script refuses any other host, creates two scratch databases, loads schema.sql into "before",
 * applies the migration to "after", and drops both databases at the end, also after a failure.
 *
 * Checks, all required:
 *   1. The policy set (table, name, command, roles, permissive) is identical before and after.
 *   2. Each USING / WITH CHECK expression is identical once the migration's (select ...) wrappers
 *      are removed. Whitespace is ignored; nothing else is.
 *   3. No auth call is left bare in "after": every auth.uid(), user_has_permission(...),
 *      get_auth_user_role() and get_auth_user_dept() is inside a (select ...) initPlan.
 *   4. EXPLAIN of `select count(*) from system_logs` as an admin-like authenticated session has an
 *      InitPlan in "after". EXPLAIN ANALYZE timings for both states are printed for comparison.
 *   5. With --live: the "before" definitions equal production's pg_policies (SUPABASE_DB_URL, read
 *      only). Run this before applying the migration, so a stale migration is caught.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const adminUrl = option("--admin-url", process.env.RLS_SCRATCH_ADMIN_URL);
const schemaPath = option("--schema", path.join(root, "src/lib/db/schema.sql"));
const migrationPath = option("--migration", path.join(root, "src/lib/db/migration_43.sql"));
const compareLive = args.includes("--live");
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const AUTH_ALIASES = ["uid", "user_has_permission", "get_auth_user_role", "get_auth_user_dept"];

if (!adminUrl) throw new Error("pass --admin-url or set RLS_SCRATCH_ADMIN_URL");
const admin = new URL(adminUrl);
if (!LOOPBACK.has(admin.hostname)) throw new Error(`refusing non-local host ${admin.hostname}`);

const tag = `${process.pid}_${Date.now()}`;
const beforeDb = `klinikaid_rls_before_${tag}`;
const afterDb = `klinikaid_rls_after_${tag}`;
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "klinikaid-rls-"));

// Minimal stand-ins for the Supabase-owned objects schema.sql refers to. The auth helpers match
// Supabase's definitions (they read the request.jwt.claim.* settings).
const STUBS = `
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
create or replace function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')::text;
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;
create table if not exists auth.users (
  id uuid primary key, email text, email_confirmed_at timestamptz, phone text,
  raw_app_meta_data jsonb default '{}'::jsonb, raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  deleted_at timestamptz, banned_until timestamptz
);
create table if not exists storage.buckets (id text primary key, name text, public boolean default false);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
$$;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects, storage.buckets to anon, authenticated, service_role;
`;

// One active admin and 200k log rows, so EXPLAIN ANALYZE has real work to do. schema.sql already seeds
// the admin role and the system_logs.read permission; the grant is re-asserted, not assumed.
const SEED = `
set session_replication_role = replica;
insert into auth.users (id, email) values ('11111111-1111-4111-8111-111111111111', 'admin@scratch.invalid');
insert into role_permissions (role_id, permission_id)
  select r.id, p.id from roles r, permissions p where r.name = 'admin' and p.name = 'system_logs.read'
  on conflict do nothing;
insert into profiles (id, full_name, role, role_id, is_active, department)
  select '11111111-1111-4111-8111-111111111111', 'Scratch Admin', 'admin', r.id, true, 'laboratory'
  from roles r where r.name = 'admin';
insert into system_logs (event_type, description)
  select 'SCRATCH', 'row ' || g from generate_series(1, 200000) g;
analyze system_logs;
`;

const psql = (url, input) => {
  const file = path.join(workDir, `in-${Math.random().toString(36).slice(2)}.sql`);
  fs.writeFileSync(file, input, { mode: 0o600 });
  try {
    return execFileSync("psql", [url, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-f", file], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } finally {
    fs.rmSync(file, { force: true });
  }
};
const dbUrl = (name) => {
  const u = new URL(adminUrl);
  u.pathname = `/${name}`;
  return u.toString();
};
const dropAll = () => {
  for (const name of [beforeDb, afterDb]) {
    psql(adminUrl, `drop database if exists "${name}" with (force);`);
  }
};

// Policies as JSON, in a stable order. Live is read-only: the session is forced read-only too.
const POLICY_SQL = `select coalesce(json_agg(p order by schemaname, tablename, policyname), '[]'::json) from (
  select schemaname, tablename, policyname, cmd, roles, permissive, qual, with_check
  from pg_policies where schemaname in ('public', 'storage')) p;`;
const readPolicies = (url, readOnly = false) => {
  const raw = execFileSync("psql", [url, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", POLICY_SQL], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    env: readOnly ? { ...process.env, PGOPTIONS: "-c default_transaction_read_only=on" } : process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(raw);
};

// Remove the (select ...) wrappers the deparser prints as "( SELECT <expr> AS <alias>)", recursively,
// then drop schema qualifiers and whitespace, so only the policy logic is compared.
function stripWrappers(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (!text.startsWith("( SELECT ", i)) {
      out += text[i++];
      continue;
    }
    let depth = 0;
    let end = -1;
    for (let j = i; j < text.length; j++) {
      if (text[j] === "(") depth++;
      else if (text[j] === ")" && --depth === 0) {
        end = j;
        break;
      }
    }
    const inner = text.slice(i + "( SELECT ".length, end);
    const alias = inner.match(/ AS (\w+)$/);
    if (end !== -1 && alias && AUTH_ALIASES.includes(alias[1])) {
      out += stripWrappers(inner.slice(0, -(alias[0].length)));
      i = end + 1;
    } else {
      out += text[i++];
    }
  }
  return out.replace(/\bpublic\./g, "").replace(/\s+/g, " ").trim();
}

const bareAuthCall = /(?<!\( SELECT )(?:public\.)?(?:auth\.uid\(\)|user_has_permission\(|get_auth_user_(?:role|dept)\(\))/g;

const key = (p) => `${p.schemaname}.${p.tablename} | ${p.policyname}`;
const identity = (p) => `${key(p)} | ${p.cmd} | ${JSON.stringify(p.roles)} | ${p.permissive}`;

function comparePolicies(label, expected, actual) {
  const problems = [];
  const idA = expected.map(identity).sort();
  const idB = actual.map(identity).sort();
  for (const id of idA) if (!idB.includes(id)) problems.push(`${label}: missing or changed ${id}`);
  for (const id of idB) if (!idA.includes(id)) problems.push(`${label}: unexpected ${id}`);
  const byKey = new Map(actual.map((p) => [key(p), p]));
  for (const e of expected) {
    const a = byKey.get(key(e));
    if (!a) continue;
    for (const field of ["qual", "with_check"]) {
      const want = stripWrappers(e[field] ?? "");
      const got = stripWrappers(a[field] ?? "");
      if (want !== got) problems.push(`${label}: ${field} differs for ${key(e)}\n    before: ${want}\n    after:  ${got}`);
    }
  }
  return problems;
}

function bareCalls(policies) {
  return policies.flatMap((p) =>
    [p.qual, p.with_check].filter(Boolean).flatMap((expr) => [...expr.matchAll(bareAuthCall)].map((m) => `${key(p)}: ${m[0]}`)),
  );
}

// The admin session: authenticated, MFA satisfied (aal2), user 1111… holds system_logs.read.
// Set inside a DO block so the set_config result rows do not end up in the EXPLAIN output.
const AS_ADMIN = `do $$ begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal2"}', true);
  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end $$;
set local role authenticated;`;

function explainCount(url, analyze) {
  const out = psql(url, `begin;\n${AS_ADMIN}\nexplain ${analyze ? "(analyze) " : ""}select count(*) from public.system_logs;\nrollback;\n`);
  return out.trim();
}

function seedAndExplain(name, label, failures) {
  psql(dbUrl(name), SEED);
  const plan = explainCount(dbUrl(name), false);
  const timed = explainCount(dbUrl(name), true);
  console.log(`\n--- ${label}: explain select count(*) from system_logs (admin, authenticated) ---`);
  console.log(plan);
  console.log(`--- ${label}: explain analyze, timing lines ---`);
  console.log(timed.split("\n").filter((l) => /Execution Time|Planning Time|Filter|InitPlan|One-Time/.test(l)).join("\n"));
  if (label === "after" && !/InitPlan/.test(plan)) failures.push("after migration: no InitPlan in the system_logs count plan");
}

const failures = [];
try {
  psql(adminUrl, `create database "${beforeDb}"; create database "${afterDb}";`);
  for (const name of [beforeDb, afterDb]) {
    psql(dbUrl(name), STUBS);
    psql(dbUrl(name), fs.readFileSync(schemaPath, "utf8"));
  }
  const before = readPolicies(dbUrl(beforeDb));
  psql(dbUrl(afterDb), fs.readFileSync(migrationPath, "utf8"));
  const after = readPolicies(dbUrl(afterDb));
  console.log(`policies: before ${before.length}, after ${after.length}`);

  failures.push(...comparePolicies("schema vs migration", before, after));
  const bare = bareCalls(after);
  for (const b of bare) failures.push(`bare auth call left after migration: ${b}`);
  if (bare.length === 0) console.log("bare auth calls after migration: 0");

  if (compareLive) {
    const live = readPolicies(process.env.SUPABASE_DB_URL, true);
    const liveFailures = comparePolicies("live vs schema.sql", live, before);
    failures.push(...liveFailures);
    console.log(`live policies: ${live.length}; differences from schema.sql: ${liveFailures.length}`);
  }

  seedAndExplain(beforeDb, "before", failures);
  seedAndExplain(afterDb, "after", failures);
} finally {
  dropAll();
  fs.rmSync(workDir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\nFAILED (${failures.length}):\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nOK: same policy set, expressions equal modulo (select ...) wrappers, no bare auth calls, InitPlan present.");
