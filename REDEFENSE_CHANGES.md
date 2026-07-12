# REDEFENSE_CHANGES.md
## KlinikAid — Consolidated Redefense Change List (Web-priority)
### Sources: Sir Vern's list, Sir Jojit's list, Doc. Goh's list, mock-defense transcript, developer annotations (green = done/ongoing on web, red = developer replies in transcript)

**Last Updated:** 2026-07-12
**Companion to:** `issues.md` (canonical tracker #1–#39). New items below are assigned **#40–#48** — append to issues.md.

---

# SECTION A — WEB CHANGES (our domain, priority)

## A1. ✅ Already done on web (green-confirmed — verify before defense, don't re-do)

| Item | Source | Status |
|---|---|---|
| Terms & service at registration (Data Privacy) | Vern | ✅ implemented on `/register` (green) |
| Complete data validation on registration | Jojit, Goh | ✅ implemented on `/register` (green) |
| Age restriction — 18+ only | Goh | ✅ web version done (green) |
| Password requirements clearly indicated (min length, characters) | Goh, Vern (partial) | ✅ web version done (green) |
| Quality checks & warnings (poor-quality disclaimer on upload) | Goh | ✅ crossed out (green-check) — **VERIFY live: does a poor-quality upload actually show the warning + let user proceed with disclaimer? Transcript suggests panelists want explicit "proceeding may cause parsing errors" text.** |

**Pre-defense action:** re-verify each of these live on Vercel. The transcript shows the panel will re-test registration validation specifically (they found the 3-char/1-char inconsistency last time — see A2/#40).

## A2. 🔴 Web changes NOT yet done — the build list

### #40 — Validation consistency across ALL name/data entry points (Jojit: complete validation; transcript)
**What the panel found:** Registration enforces first name ≥ 3 characters and email format — good. But a LATER form in the flow asked for first/last name again and **accepted a single character**. "Kung gaano kayo kastrict sa una, three letters dito, nung pangalawa single letter, inaccept niya. Hindi consistent."
**The fix:** One shared validation standard (zod schemas) applied to EVERY surface that accepts names/DOB/contact — registration, document submission, profile edit (when built, #36), reception patient-creation, admin staff forms. Same min-lengths, same rules, everywhere. Audit all entry forms for consistency, not just `/register`.
**Also from transcript — DOB bound:** the date picker showed a start year of 2008 but the panelist could still pick invalid ranges; the DOB rule must be a hard ceiling: `DOB ≤ today − 18 years` (max selectable date = 18 years ago), not just a displayed start year. Green says age restriction done on web — **re-verify the picker can't be bypassed by typing.**

### #41 — Don't re-ask the user's name after registration; auto-retrieve from profile (Goh: Name Retrieval)
**What the panel found:** After registering (name collected), a later step asked for first/last name AGAIN. Names should be collected once at registration; every subsequent flow pulls from the profile.
**Your green note asked:** "feature rich for mobile lang ba? Or web has to follow?" — **Answer: web must comply too.** The principle is Goh's, stated generally. Audit the web: does any patient-facing flow (document submit, anything) re-ask name? If web already pulls from `patients`/`profiles`, mark web-done and it becomes mobile-only work. If any web form re-asks, fix it to prefill/auto-retrieve.
**Pairs with #36:** profile editing is the sanctioned way to change the name later — Goh explicitly endorses "profile editing features may be provided," which is exactly the minimal profile page already locked in #36. Cite that alignment at defense.

### #42 — Single-upload flow: no re-upload after quality check passes (Goh: Upload Optimization; transcript, detailed)
**Your green note said "unclear for me" — transcript makes it clear:**
Current flow: patient uploads photo → system runs quality assessment (e.g. 95% score) → then requires uploading AGAIN to actually submit. Two problems the panel hammered:
1. **Waste:** double work for the user.
2. **Integrity hole:** the panelist uploaded photo A for the quality check, then submitted a DIFFERENT photo B. The validated file and the submitted file can differ. "Iba yung pinavalidate ko nung una, tas iba rin yung picture na inupload ko."
**The fix:** ONE upload. Assess quality on that file. If it passes → submit THAT SAME file (no second picker). If it fails quality → show a clear warning/disclaimer ("proceeding may result in inaccurate text extraction / incomplete parsing") and let the user proceed anyway with acknowledgment (checkbox), or re-upload a better shot. The assessed file and the submitted file must be the same object.

### #43 — Submit-button clarity: instruction text (transcript only — NOT on any panelist's written list, easy to miss)
**What the panel found:** On the patient submit page, the button just says "Submit" — panelist was lost ("Submit what?"). 
**The fix:** explicit label/instruction — "Click Submit to upload lab request" (or button text "Submit Lab Request") plus a one-line helper. Trivial UI, but it was a named complaint; cheap defense win.

### #44 — Show OCR-extracted text to the PATIENT, not just reception (transcript only — not on written lists)
**What the panel found:** The system extracts document text (OCR output visible on the reception validation screen), but the patient never sees it. "Bakit hindi siya nakikita dito [patient side]?"
**The fix:** surface the extracted text (and/or the identified lab tests — see #45) on the patient's submission view after processing. Feeds directly into #45.

### #45 — Lab-test identification + patient checkbox selection + prep-requirements knowledge base (transcript — THE BIG ONE, panel-confirmed in scope)
**This is the largest new feature and it exists ONLY in the transcript — it is not written on any of the three lists. Do not lose it.**
**What the panel wants (assembled from the discussion):**
1. Parse the uploaded lab request's extracted text and **identify the lab tests** named in it (text parsing / filtering against a known lab-test list — the panel: "kumuha lang kayo ng high-precision na lab test list, yun yung gamitin nyo na basis").
2. Present the identified tests to the patient as **checkboxes** — "here are the lab tests we found in your document; check which ones you want done." **The patient decides** which tests to actually book — a doctor's request may list tests the patient won't do at this clinic (preference, availability, cost). "Hindi dapat iassume ng system na lahat ng nakita niya ipopresent niya. Let the user decide."
3. Attach a small **knowledge base of prep requirements** per test: e.g. FBS → 8-hour fasting required; urinalysis, creatinine → no prep. Show prep info against each selected test so the patient knows before going ("malaking bagay: no preparation for urinalysis and creatinine, but FBS you must fast ~8 hours"). Panel told a story of a wasted trip from over-fasting — this is the pain point.
4. (Stretch, transcript mention) fast-lane concept: pre-registered/pre-submitted patients get expedited verification on arrival — QR code was floated. Treat as optional/stretch, not core.
**Scope confirmation (red highlights — your own replies):** you proposed OCR text-parsing to confine against the RAG environment; panel confirmed "pwede naman po, within the scope of the study, especially the OCR being used for parsing." **This is sanctioned scope. Build it.**
**Implementation sketch (for planning, not final):** extracted text (already have `ocr_text`/`extracted_metadata` on `documents`) → match against a canonical lab-test list (ties into #26 canonical test-name discipline!) → store identified tests → patient submission view renders checkboxes → selection stored → reception sees the patient's chosen tests at triage. Prep-requirements = a constants table (test → prep text). NO AI diagnostics anywhere in this — it's test-name identification + static prep info, which stays inside SO-C's no-diagnostics line. State that explicitly at defense.

### #46 — Out-of-range confirmation/validation (Jojit — unchecked on his list)
**What it is:** When a department-staff enters a test value that falls out of the reference range, the system should ask for confirmation/validation before saving (guard against typos producing false flags — e.g. 240/780 BP seen in test data is an obvious typo that sailed through).
**The fix:** on record entry, if `test_value` is outside `reference_range_min/max`, show an inline confirm ("Value is out of normal range — confirm this is correct") before submit. Not a block, a confirm.

### #47 — Role settings / new admin-role provisioning (Vern: new employee types; Jojit: role settings)
**What it is:** Admin should be able to handle new types of employees — today roles are a hard-coded enum (`admin, receptionist, department_staff, medical_specialist, patient`). Panel wants provisioning flexibility for new employee types.
**Reality check:** a fully dynamic role system is a schema + RLS overhaul (role CHECK constraints everywhere, `get_auth_user_role()` logic). For redefense, scope the MINIMUM defensible version: clear role-management UI in admin (assign/edit roles among the existing set, department assignment) + document how a new role would be added. Discuss before building — flag if the panel literally requires runtime-creatable roles (expensive) vs. better role administration UX (cheap). **Needs a scoping decision — do not let this silently balloon.**

### #48 — Third-party security testing (Vern)
**What it is:** include third-party security tests in the project evidence. Not a code feature — a testing/documentation task: run an external scanner (e.g. OWASP ZAP baseline scan against the live URL, npm audit, Supabase linter) and include results in documentation. Cheap, high defense value given the DPA/security story.

## A3. 🟡 Ongoing on web (green "/ongoing" — finish these)

| Item | Source | Status |
|---|---|---|
| Rejection reasons — pre-made selector | Jojit | 🟡 /ongoing for web — finish + verify |
| "Others" option when reason not in selection | Jojit | 🟡 /ongoing for web — finish + verify |
| Valid test data for various scenarios | Jojit, Vern (graphs) | 🟡 /ongoing — ties directly to #23 data cleanup + seeding: purge junk (141 pending / 201 staff) AND seed realistic demo data for graphs + analytics. One combined data task. |

## A4. Web documentation
- **Update system documentation to current look** (Vern) — after the redefense changes land, refresh screenshots/docs. Also fold in #14 (no-diagnosis rule) + #15 (chat sync rule) while touching docs — closes Batch 5 docs in the same pass.

---

# SECTION B — MOBILE CHANGES (coordinate with mobile team, not ours to build)

| Item | Source | Notes for handoff |
|---|---|---|
| Mobile app used for more than uploading documents — address other objectives | Vern, Jojit | Core mobile scope expansion |
| Age/data validation in mobile app | Jojit (crossed: age), Goh | Mirror web's validation rules — share the zod schema rules in the handoff so web/mobile validate identically (#40 consistency applies cross-platform) |
| Web-to-mobile parity: most web functions in mobile | Jojit | Big one for mobile team |
| Analytics dashboard test data (mobile validation) | Jojit | Covered by the combined data task in A3 |
| Name retrieval / don't re-ask names (mobile side) | Goh | Your green note suspects this is mobile-primary — confirm which platform the panelist tested; fix both |
| Terms & service at registration (mobile) | Vern | Web done; mobile must mirror |
| Password requirements indication (mobile) | Goh | Web done; mobile must mirror |
| Single-upload flow (mobile, if mobile has upload) | Goh | Mirror #42 |

**Handoff artifact:** send mobile team this file's Section B + the shared validation rules once #40 lands on web.

---

# SECTION C — GAP ANALYSIS: what the green checklist MISSED

Your question: "I don't know if the checklists are complete." They are not. Items that exist in the transcript but on NO written list and have NO green mark:

1. **#43 Submit-button instruction text** — transcript only. Trivial but named.
2. **#44 OCR text visible to patient** — transcript only.
3. **#45 Lab-test checkbox selection + prep knowledge base** — transcript only, and it is the BIGGEST new feature the panel pushed, explicitly confirmed in-scope. The green checklists have zero trace of it. Highest risk of being forgotten; highest defense value if delivered.
4. **#42 single-upload integrity hole** (validated file ≠ submitted file) — the written list says "upload once," but the transcript's integrity angle (swapping files between validation and submit) is stronger than the checklist wording and shapes the correct fix. Your green note said "unclear" — it is now clear.
5. **#40 validation inconsistency specifics** (3-char vs 1-char, DOB hard ceiling) — the written lists say "complete validation"; the transcript gives the exact failing cases the panel will re-test. Fix those exact cases.
6. **Doc Goh Profile Updates** — his list endorses profile editing; this is already locked as the #36 minimal profile page. Not missed, but the alignment wasn't marked — cite it at defense as "panel-requested, delivered."

Items green-checked that should be RE-VERIFIED live before defense (panel will retest):
- Registration validation (all fields, typed input not just picker)
- Age 18+ ceiling (try typing a DOB, not just picking)
- Password requirements display
- Quality-check warning actually appears on a bad upload

---

# SECTION D — PRIORITY ORDER (web, proposed)

1. **#40 + #41** — validation consistency + no name re-ask. The panel found these live and WILL retest them. Cheapest credibility.
2. **#42 + #43** — single-upload flow + submit-button text. Same page (`/patient/submit`), one batch.
3. **#45 (+#44)** — lab-test identification + checkbox selection + prep knowledge base, surfacing extracted text to patient. The flagship redefense feature; panel-sanctioned scope. Needs a real plan (touches documents flow, canonical test names #26, constants). Start its design early even while 1–2 build.
4. **#46** — out-of-range confirm on record entry. Small, contained.
5. **A3 ongoing** — finish rejection-reason selectors + "Others"; combined data cleanup + seeding task (#23 merged).
6. **#47** — role settings, minimum-defensible scope (decision needed first).
7. **#48 + docs** — security scan + documentation refresh, last (docs reflect final state).

**Interaction with existing tracker:** Auth-Privacy batch (#31/#35/#36) still queued — #36's profile page is now ALSO a panel request (Goh), raising its priority. #32 (registration + Confirm email) still needs its Vercel error. #33 (Disagree button) still awaiting walkthrough/commit. #38 (specialist redesign) unaffected — still design-first, separate track.
