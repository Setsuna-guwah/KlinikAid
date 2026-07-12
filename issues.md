# KlinikAid — Issue Tracker (canonical)
**Last updated:** 2026-07-11 (post re-defense feedback + Codex R1)
**Companion:** MASTER_CONTEXT_14_TRANSFER.md (facts + behavioral contract). This file = live campaign state.

Legend: 🟢 done+live · 🟡 built-not-pushed / in-flight · 🔵 queued (actionable) · 🔴 blocked · 🅿️ parked (clinic/adviser/design input needed) · ⏭ deferred

---

## RE-DEFENSE — RECOMMENDED ORDER (the 6 open decisions, sequenced)

My recommended lock order for the open decisions (rationale after each):

1. **Push R1?** → decide FIRST. R1 is built, clean, addresses top-priority panelist items (age, password, name-once). Blocking nothing by sitting unpushed except your own momentum. Push → live-verify → everything else builds on a known-good base. **Recommend: yes, push now.**
2. **Password rule spec** → needed to confirm R1 is demo-correct. Cheap, unblocks R1 verification. Panelists want requirements shown clearly pre-typing (not just on error).
3. **Test-data seeding (R6) priority** → pull FORWARD. You cannot demo analytics/graphs to the panel without deterministic data; three panelists asked. Do before R2/R3 so every later batch is demonstrable.
4. **ToS distinct from RA 10173?** → drives whether R7 exists. Small build if yes. Decide early so registration flow isn't reworked twice.
5. **Consent granularity** → does the paper require per-checkbox versioned DB fields? R1 is UI-only. If paper promises granular stored evidence → gap to close. Check the document.
6. **Batch order confirm** → after 1-5, ratify R1→R6→R2→R3→R4→R7→R5 or reprioritize.

Security-headers-pushed? = a 7th confirm (verify live state; not a build decision).

---

## RE-DEFENSE BATCHES

- 🟡 **R1 — Registration/validation/profile (Codex, BUILT isolated, NOT pushed).** Age 18+ PHT-anchored (register + reception modal, server-enforced, boundary-tested). Password rules shown+enforced across register/reset/profile. Duplicate-email friendly msg. Name read-only post-registration; profile edits contact/address only. Privacy scroll-to-bottom + 4 checkboxes. PROFILE_UPDATED audit+badge. Alert icon-grid fix. 13 files, no migration/deps/admin-bypass, lint+build clean. **NEXT: Antigravity fetch Codex files → push → live-verify.**
- 🔵 **R6 — Test-data seeding.** Deterministic patients/documents/queues/numeric+text results/normal+out-of-range/rejected/time-series for analytics graphs. PULL FORWARD — demo dependency.
- 🔵 **R2 — Reception rejection reasons.** Preset selector + "Others" + required custom text when Others + stored/audited reason.
- 🔵 **R3 — Complete validation + out-of-range confirmation.** Inventory EVERY data-entry route first → define bounds/format → confirm-dialog for medically-unusual-but-valid (don't hard-block, confirm).
- 🔵 **R4 — Upload-once / OCR quality workflow.** Upload → quality assess → pass = no re-upload; poor = warning/disclaimer + proceed-anyway. Depends on OCR contract w/ mobile.
- 🔵 **R7 — Terms of Service at registration.** Only if confirmed distinct from RA 10173 privacy.
- 🅿️ **R5 — Custom admin roles.** Admin creates new employee-type roles / account-role settings. Biggest, most invasive (touches role gates + RLS everywhere). Defer, design carefully.
- 🔵 **Docs/security evidence.** Update screenshots + system-flow docs w/ current look. Document ZAP-by-Checkmarx third-party testing (clean scan, hardening-header findings only, CSP report-only).
- 🅿️ **Mobile parity.** More usage beyond upload, web feature parity, age/password/privacy validation. Needs a shared validation/consent/OCR contract first (Codex flagged).

---

## SHIPPED (🟢 live)
#1 file signed-URL+anchor · #3 priority hidden · #6 specialist link removed · #8 Not-available · #16 record-entry link · #19 cancel button · #20 NORMAL-off-text · #22 queue auto-complete (QUEUE_COMPLETED) · #25 chart empty-state text · #27 dest dept on approval · #28 PHT queue filter · #29 triage dedup 409 · #30 admin staff pw fix (superseded by #36) · #31 forgot/reset (SITE_ORIGIN + token_hash + interstitial + AAL2 step-up, scanner-safe, both paths live) · #32 registration 4-branch · #33 privacy disagree · #34/#37 staff panel+badges · #35 formatted temp pw · #36 remove admin pw control + profile page · #38 Specialist Private Workspace (Model A) · Batch 1 (PHT queue integrity) · Batch 1.5 (TOTP MFA enroll+challenge+gate) · Batch 3 (UI cleanups) · Template Module (6 forms) · mobile responsive drawer · favicon (brand icon) · Vercel iad1→syd1 · Checklist v2 (100%, weights 23/12/17/31/17) + 4 sprint scripts (30/60/90/100) · B2 docs (#14 no-diagnosis rule, #15 chat-sync reinforce).

- 🟡 **Security headers** — next.config.mjs: report-only CSP, HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, Permissions-Policy, X-Powered-By removed. Built + build-clean. **CONFIRM whether pushed to live.** CSP intentionally report-only (enforce = post-defense, breakage risk). Cookie ZAP finding = scan artifact (HTTP vs HTTPS; Supabase sets Secure in prod) — dismissed, auth cookies untouched.

---

## 🔴 BLOCKED — Resend→Supabase SMTP wire (single unblock for 3)
Mobile team owns Resend creds; must point Supabase Auth SMTP at Resend (host smtp.resend.com, user 'resend', pass=API key, verified sender @klinikaid.com — shared domain klinikaid.com). Sender still shows supabase.io = UNWIRED.
- #12 Confirm-email ON
- #32-C registration Branch C live-verify (code done, email path untested)
- #31 email reliability (works single-shot, rate-limited on default sender ~2-4/hr)

---

## 🅿️ PARKED — clinic/adviser input
#4 departments 4→8 (Consultation/Lab/X-ray/Drug Test/ECG/Vaccination/2D Echo/Ultrasound/APE — which are true depts vs umbrella) · #17 reference ranges vs clinic actuals · #21 previous-findings panel scope · #26 canonical test-name discipline across LAB_TEST_PANELS.

## 🅿️ PARKED — data ops
#23 test-data cleanup (SELECT-first SQL ready; @test accounts KEPT intentionally, remove post-defense) · #5 unknown-patient blank submissions (folded into #23).

## ⏭ DEFERRED
#9 in-progress 24h auto-expire (deprioritized post-#22) · #11 CHAT_RATE_LIMIT env wire-or-drop · #13 doctor AI chat history viewer (conditional) · #18 age/sex reference-range stratification (likely won't-do) · #24 AI-Verified/Staff-Review Kanban needs ocr_confidence (OCR now mobile-only → likely N/A) · #40 staff/page.tsx 561-line monolith → server/client split refactor (POST-DEFENSE, regression risk).

## 🔵 RAG #39
Content-first restructure: user re-uploads topic-coherent titled chunks via /admin/rag. Threshold STAYS 0.6 (user decided against 0.5). RAG_CONTENT_GUIDELINES.md may exist in documentation/. Sync BOTH chat files if code ever touched.

---

## KEY DECISIONS (do not re-litigate)
Capacitor/AWS/Singapore-migration/Redis REJECTED · Mobile OCR = on-device ML Kit, WEB_OCR_ENABLED=false, OCR removed from web checklist · AlertDialog @base-ui/react · Resend = SMTP transport (approved, pending wire), NOT patient email-OTP-MFA · MFA staff-mandatory / patients email-confirmation · priority level HIDDEN not migrated (outpatient) · Specialist = Model A private confidential workspace, admin excluded (legal) · reset = token_hash+interstitial+AAL2 · RAG threshold stays 0.6 · checklist weights float · Gmail plus-trick +t1/+t2 for test accounts.

## MOBILE COORDINATION OWED
migration_12 taken by web → mobile uses 13+ · web /reset-password is the shared reset landing (mobile Option A: links land on web page, ~zero mobile work; recommended) · shared email template — don't change without telling web · SMTP wiring benefits both · shared validation/consent/OCR contract needed before mobile parity work.
