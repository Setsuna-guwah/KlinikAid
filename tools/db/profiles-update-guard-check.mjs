#!/usr/bin/env node
/**
 * Proves the #256 fix in migration_47: a patient's own public.profiles UPDATE no
 * longer recurses, and the protected columns stay locked for everyone else.
 *
 *   node tools/db/profiles-update-guard-check.mjs --admin-url postgresql://postgres:PW@127.0.0.1:PORT/postgres
 *
 * --admin-url must be a LOCAL throwaway Postgres with the Supabase roles and
 * pgvector (the supabase/postgres image works; start one with
 *   docker run -d --rm --name kl256-pg -e POSTGRES_PASSWORD=... -p 127.0.0.1:PORT:5432 supabase/postgres:17.6.1.081
 * ). The script refuses any other host. It creates two scratch databases,
 * loads schema.sql plus migration_43 into "before" — the production state today —
 * and adds migration_47 to "after", then drops both, also after a failure.
 *
 * Assertions, one PASS/FAIL line each:
 *   a. before: a patient self-update of accepted_privacy_at reproduces the
 *      recursion error (SQLSTATE 42P17), the original #256 failure.
 *   b. after: a patient can update accepted_privacy_at and their full_name.
 *   c. after: a patient gets 42501 on each of the five protected columns,
 *      one at a time.
 *   d. after: a patient updating another user's row affects 0 rows.
 *   e. after: a profiles.manage admin changes another profile's protected
 *      columns; service_role does too.
 *   f. after: the SECURITY DEFINER trigger sync_email_verified_at can set
 *      email_verified_at.
 *   g. after: an inactive patient cannot update their own row.
 */
import { spawnSync } from "node:child_process";
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
const migration43 = option("--migration-43", path.join(root, "src/lib/db/migration_43.sql"));
const migration47 = option("--migration-47", path.join(root, "src/lib/db/migration_47.sql"));

if (!adminUrl) throw new Error("pass --admin-url or set RLS_SCRATCH_ADMIN_URL");
const admin = new URL(adminUrl);
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
if (!LOOPBACK.has(admin.hostname)) throw new Error(`refusing non-local host ${admin.hostname}`);

const tag = `${process.pid}_${Date.now()}`;
const beforeDb = `klinikaid_guard_before_${tag}`;
const afterDb = `klinikaid_guard_after_${tag}`;
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "klinikaid-guard-"));

// Minimal stand-ins for the Supabase-owned objects schema.sql refers to, same as
// tools/perf/rls-policy-diff.mjs. The auth helpers read the request.jwt.claim.*
// settings, so a "session" is just those settings plus set role.
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
-- Supabase grants these in every project; without USAGE on auth, a policy's
-- (select auth.uid()) cannot even evaluate, which is not the state we test.
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects, storage.buckets to anon, authenticated, service_role;
`;

const P1 = "aaaa1111-1111-4111-8111-111111111111"; // active patient (role_id set)
const P2 = "aaaa2222-2222-4222-8222-222222222222"; // inactive patient
const OTHER = "aaaa3333-3333-4333-8333-333333333333"; // another active patient
const ADMIN = "aaaa4444-4444-4444-8444-444444444444"; // profiles.manage holder
const LEGACY = "aaaa5555-5555-4555-8555-555555555555"; // pre-role_id patient (role_id null)

// Triggers off while seeding so handle_new_user and the role sync do not run.
const SEED = `
set session_replication_role = replica;
insert into auth.users (id, email, email_confirmed_at) values
  ('${P1}', 'p1@scratch.invalid', null),
  ('${P2}', 'p2@scratch.invalid', null),
  ('${OTHER}', 'other@scratch.invalid', null),
  ('${LEGACY}', 'legacy@scratch.invalid', null),
  ('${ADMIN}', 'admin@scratch.invalid', null);
insert into public.profiles (id, full_name, role, role_id, is_active, department)
select v.id::uuid, v.full_name, v.role, r.id, v.is_active, v.department
  from (values
    ('${P1}', 'Patient One', 'patient', true, null::text),
    ('${P2}', 'Patient Two', 'patient', false, null::text),
    ('${OTHER}', 'Patient Nine', 'patient', true, null::text)
  ) v(id, full_name, role, is_active, department)
  join public.roles r on r.name = v.role;
-- A profile from before role_id existed: role_id is null, so the role sync
-- trigger does not rewrite the role from it.
insert into public.profiles (id, full_name, role, role_id, is_active, department)
values ('${LEGACY}', 'Legacy Patient', 'patient', null, true, null);
insert into public.profiles (id, full_name, role, role_id, is_active, department)
select '${ADMIN}', 'Scratch Admin', 'admin', r.id, true, null
  from public.roles r where r.name = 'admin';
reset session_replication_role;
`;

const dbUrl = (name) => {
  const u = new URL(adminUrl);
  u.pathname = `/${name}`;
  return u.toString();
};

// Run a SQL script through psql, capturing status and output instead of throwing.
function psqlRun(url, sql) {
  const file = path.join(workDir, `q-${Math.random().toString(36).slice(2)}.sql`);
  fs.writeFileSync(file, sql, { mode: 0o600 });
  try {
    const r = spawnSync("psql", [url, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-f", file], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
  } finally {
    fs.rmSync(file, { force: true });
  }
}

// A "session": the JWT claim settings auth.uid()/auth.role()/auth.jwt() read.
// aal2 satisfies auth_session_satisfies_mfa(), as an admin's session would.
const asSession = (uuid, role = "authenticated", aal = "aal2") => `
do $sess$ begin
  perform set_config('request.jwt.claims', '{"sub":"${uuid}","role":"${role}","aal":"${aal}"}', true);
  perform set_config('request.jwt.claim.sub', '${uuid}', true);
  perform set_config('request.jwt.claim.role', '${role}', true);
end $sess$;
`;

// Update as an authenticated user and return the affected row count. A
// data-modifying CTE is the only way to RETURNING out of an UPDATE at top level.
const updateCount = (uuid, setClause, targetId) => `begin;
${asSession(uuid)}
set local role authenticated;
with x as (update public.profiles set ${setClause} where id = '${targetId}' returning 1)
select count(*) from x;
rollback;
`;

// Update as an authenticated user expecting the guard to refuse with 42501.
// Only the guard's own message counts: any other 42501 (a permission denial
// elsewhere) or a success raises, so a PASS means this column was rejected by
// protect_profile_columns itself.
const GUARD_ERROR = "Role, department, account status and email verification can only be changed by an administrator.";
const updateRefused = (uuid, setClause, targetId) => `begin;
${asSession(uuid)}
set local role authenticated;
do $guard$ begin
  update public.profiles set ${setClause} where id = '${targetId}';
  raise exception 'GUARD MISSED: the update was not refused' using errcode = 'P0001';
exception
  when sqlstate '42501' then
    if sqlerrm <> '${GUARD_ERROR}' then
      raise;
    end if;
end $guard$;
rollback;
`;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const dropAll = () => {
  for (const name of [beforeDb, afterDb]) psqlRun(adminUrl, `drop database if exists "${name}" with (force);`);
};

// role only actually changes when role_id is null: otherwise the role sync
// trigger rewrites NEW.role from role_id, so LEGACY exercises that column.
const PROTECTED = [
  ["role", "role = 'admin'", LEGACY],
  ["role_id", `role_id = (select id from public.roles where name = 'admin')`, P1],
  ["department", "department = 'laboratory'", P1],
  ["is_active", "is_active = false", P1],
  ["email_verified_at", "email_verified_at = now()", P1],
];

try {
  psqlRun(adminUrl, `create database "${beforeDb}"; create database "${afterDb}";`);
  for (const name of [beforeDb, afterDb]) {
    const url = dbUrl(name);
    const stubs = psqlRun(url, STUBS);
    if (stubs.code !== 0) throw new Error(`stubs failed in ${name}: ${stubs.err}`);
    const schema = psqlRun(url, fs.readFileSync(schemaPath, "utf8"));
    if (schema.code !== 0) throw new Error(`schema.sql failed in ${name}: ${schema.err.slice(-2000)}`);
    const m43 = psqlRun(url, fs.readFileSync(migration43, "utf8"));
    if (m43.code !== 0) throw new Error(`migration_43 failed in ${name}: ${m43.err.slice(-2000)}`);
    const seed = psqlRun(url, SEED);
    if (seed.code !== 0) throw new Error(`seed failed in ${name}: ${seed.err.slice(-2000)}`);
  }
  const m47 = psqlRun(dbUrl(afterDb), fs.readFileSync(migration47, "utf8"));
  if (m47.code !== 0) throw new Error(`migration_47 failed: ${m47.err.slice(-2000)}`);

  // (a) before: the recursion #256 reports.
  {
    const r = psqlRun(dbUrl(beforeDb), `begin;
${asSession(P1)}
set local role authenticated;
update public.profiles set accepted_privacy_at = now() where id = '${P1}';
rollback;
`);
    const recursed = /infinite recursion detected in policy for relation "profiles"/.test(r.err);
    check(
      "a. before migration_47: patient self-update reproduces the recursion",
      r.code !== 0 && recursed,
      recursed ? "42P17 raised" : `exit ${r.code}: ${(r.err.split("\n")[0] || r.out).slice(0, 160)}`,
    );
  }

  // (b) after: the two writes a patient actually makes.
  {
    const privacy = psqlRun(dbUrl(afterDb), updateCount(P1, "accepted_privacy_at = now()", P1));
    check("b1. after: patient updates accepted_privacy_at (1 row)", privacy.out === "1", `rows=${privacy.out || privacy.err.slice(0, 160)}`);
    const name = psqlRun(dbUrl(afterDb), updateCount(P1, "full_name = 'Patient One Renamed'", P1));
    check("b2. after: patient updates full_name (1 row)", name.out === "1", `rows=${name.out || name.err.slice(0, 160)}`);
  }

  // (c) after: each protected column refused with 42501.
  for (const [label, setClause, target] of PROTECTED) {
    const r = psqlRun(dbUrl(afterDb), updateRefused(target, setClause, target));
    const missed = /GUARD MISSED/.test(r.err);
    check(
      `c. after: patient changing ${label} is refused (42501)`,
      r.code === 0,
      r.code === 0 ? "" : missed ? "the guard let the change through" : `exit ${r.code}: ${(r.err.split("\n")[0] || "").slice(0, 160)}`,
    );
  }

  // (d) after: another user's row is out of reach.
  {
    const r = psqlRun(dbUrl(afterDb), updateCount(P1, "full_name = 'Hacked'", OTHER));
    check("d. after: patient updating another user's row affects 0 rows", r.out === "0", `rows=${r.out || r.err.slice(0, 160)}`);
  }

  // (e) after: the two privileged writers.
  {
    const r = psqlRun(
      dbUrl(afterDb),
      `begin;
${asSession(ADMIN)}
set local role authenticated;
with x as (update public.profiles
  set role_id = (select id from public.roles where name = 'department_staff'), department = 'laboratory'
  where id = '${OTHER}' returning 1)
select count(*) from x;
rollback;
`,
    );
    check("e1. after: profiles.manage admin changes another profile's protected columns", r.out === "1", `rows=${r.out || r.err.slice(0, 160)}`);

    const sr = psqlRun(
      dbUrl(afterDb),
      `begin;
set local role service_role;
with x as (update public.profiles set is_active = false where id = '${OTHER}' returning 1)
select count(*) from x;
rollback;
`,
    );
    check("e2. after: service_role changes a protected column", sr.out === "1", `rows=${sr.out || sr.err.slice(0, 160)}`);
  }

  // (f) after: the SECURITY DEFINER trigger path.
  {
    const r = psqlRun(
      dbUrl(afterDb),
      `update public.profiles set email_verified_at = null where id = '${P1}';
update auth.users set email_confirmed_at = now() where id = '${P1}';
select email_verified_at is not null from public.profiles where id = '${P1}';
`,
    );
    check("f. after: SECURITY DEFINER sync_email_verified_at sets email_verified_at", r.out === "t", `result=${r.out || r.err.slice(0, 160)}`);
  }

  // (g) after: the inactive-patient USING clause still holds.
  {
    const r = psqlRun(dbUrl(afterDb), updateCount(P2, "full_name = 'Zombie'", P2));
    check("g. after: inactive patient cannot update their own row (0 rows)", r.out === "0", `rows=${r.out || r.err.slice(0, 160)}`);
  }
} finally {
  dropAll();
  fs.rmSync(workDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} assertions passed.`);
if (failed.length) {
  console.error(`FAILED: ${failed.map((r) => r.name).join("; ")}`);
  process.exit(1);
}
console.log("OK: the recursion is gone and the protected columns stay locked.");
