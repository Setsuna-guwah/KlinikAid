# Role-Based Access Control & Routing Protocol
*Reference mapping user roles, route restrictions, landing pages, and system audit events*

This document defines how roles access subpaths in the KlinikAid web portal, and how actions are mapped to specific system audit log events.

---

## Role-to-Route Mapping

KlinikAid uses Next.js route folders and layouts to partition role access. The role gate in `(dashboard)/layout.tsx` enforces the following boundaries:

| User Role | Accessible Route Prefixes | Landing Page (Dashboard) | Purpose |
| :--- | :--- | :--- | :--- |
| **`admin`** | `/admin/*`, `/reception/*`, `/department/*`, `/specialist/*`, `/patient/*` | `/admin/dashboard` | Administrator with unrestricted access across all portal sectors, configuration panels, RAG indexes, and system audit logs. |
| **`receptionist`** | `/reception/*` | `/reception/dashboard` | Receptionist managing patient registration, documents validation queue, and waitlist routing. |
| **`department_staff`** | `/department/*` | `/department/dashboard` | Technologists uploading test metrics and viewing queue lists within their assigned department only. |
| **`medical_specialist`** | `/specialist/*` | `/specialist/dashboard` | Physicians searching patients and viewing longitudinal health analytics. Access is read-only. |
| **`patient`** | `/patient/*` | `/patient/dashboard` | Registered clinic patients submitting files, checking queue status, running RAG chats, and reading lab results. |

*Note: The layout gate in `(dashboard)/layout.tsx` explicitly permits `admin` users on every dashboard route prefix (e.g. `/reception`, `/department`), allowing them to view and test all interfaces without role switching.*

---

## System Event Types (`SYSTEM_EVENT_TYPES`)

Audit logging is structured type-safely. Developers must import events from `src/lib/constants.ts` (never write raw strings). The table below lists the 21 registered event types and the operations that emit them:

| Event Type Constant | database value | Emitted By / Triggering Operation |
| :--- | :--- | :--- |
| `LOGIN_SUCCESS` | `"LOGIN_SUCCESS"` | Successful password or MFA validation in [loginAction](file:///c:/Users/johnr/Desktop/Klinikaid/src/app/(auth)/login/actions.ts). |
| `LOGIN_FAILED` | `"LOGIN_FAILED"` | Unsuccessful passwords, invalid email syntax, or wrong MFA codes in [loginAction](file:///c:/Users/johnr/Desktop/Klinikaid/src/app/(auth)/login/actions.ts). |
| `LOGOUT` | `"LOGOUT"` | Sign out action triggers standard session invalidation in [logoutAction](file:///c:/Users/johnr/Desktop/Klinikaid/src/app/(auth)/logout/actions.ts). |
| `USER_REGISTERED` | `"USER_REGISTERED"` | Patient created via client-side registration or front-desk creation helper in [createPatient](file:///c:/Users/johnr/Desktop/Klinikaid/src/lib/patient/createPatient.ts). Also written by database auth triggers. |
| `STAFF_CREATED` | `"STAFF_CREATED"` | Admin adds a new portal user (receptionist, specialist, technologist) via [POST /api/admin/staff](file:///c:/Users/johnr/Desktop/Klinikaid/src/app/api/admin/staff/route.ts). |
| `STAFF_UPDATED` | `"STAFF_UPDATED"` | Admin updates profile attributes (name, role, department) in [PUT /api/admin/staff/[id]](file:///c:/Users/johnr/Desktop/Klinikaid/src/app/api/admin/staff/[id]/route.ts). |
| `STAFF_ACTIVATED` | `"STAFF_ACTIVATED"` | Admin toggles a deactivated profile back to active in [PATCH /api/admin/staff/[id]](file:///c:/Users/johnr/Desktop/Klinikaid/src/app/api/admin/staff/[id]/route.ts). |
| `STAFF_DEACTIVATED` | `"STAFF_DEACTIVATED"` | Admin deactivates a profile and signs them out in [PATCH /api/admin/staff/[id]](file:///c:/Users/johnr/Desktop/Klinikaid/src/app/api/admin/staff/[id]/route.ts). |
| `DOCUMENT_APPROVED` | `"DOCUMENT_APPROVED"` | Receptionist approves a patient submission and creates a queue entry in [approveDocumentAction](file:///c:/Users/johnr/Desktop/Klinikaid/src/app/(dashboard)/reception/queue/[documentId]/actions.ts). |
| `DOCUMENT_REJECTED` | `"DOCUMENT_REJECTED"` | Receptionist rejects a submission with a detailed reason in [rejectDocumentAction](file:///c:/Users/johnr/Desktop/Klinikaid/src/app/(dashboard)/reception/queue/[documentId]/actions.ts). |
| `TRIAGE_COMPLETED` | `"TRIAGE_COMPLETED"` | (Legacy / Internal) Recorded when documents are triaged and sorted. |
| `RECORD_ENTERED` | `"RECORD_ENTERED"` | Department staff records a diagnostic test metric in [submitRecordAction](file:///c:/Users/johnr/Desktop/Klinikaid/src/app/(dashboard)/department/records/entry/[patientId]/actions.ts). |
| `RAG_DOCUMENT_UPLOADED` | `"RAG_DOCUMENT_UPLOADED"`| Admin uploads a clinic guideline text chunk to pgvector in [uploadRAGDocumentAction](file:///c:/Users/johnr/Desktop/Klinikaid/src/app/(dashboard)/admin/rag/actions.ts). |
| `RAG_DOCUMENT_DELETED` | `"RAG_DOCUMENT_DELETED"` | Admin deletes an index chunk in [deleteRAGDocumentAction](file:///c:/Users/johnr/Desktop/Klinikaid/src/app/(dashboard)/admin/rag/actions.ts). |
| `ACCESS_DENIED` | `"ACCESS_DENIED"` | Middleware/Layout role-gate rejects an unpermitted path request in [layout.tsx](file:///c:/Users/johnr/Desktop/Klinikaid/src/app/(dashboard)/layout.tsx). |
| `EXPORT_SYSTEM_LOGS` | `"EXPORT_SYSTEM_LOGS"` | Admin downloads audit reports as JSON/CSV in [downloadSystemLogsAction](file:///c:/Users/johnr/Desktop/Klinikaid/src/app/(dashboard)/admin/logs/actions.ts). |
| `STAFF_ACTION_FAILED` | `"STAFF_ACTION_FAILED"` | Server-side actions triggered by clinic personnel fail during critical transactions. |
| `DOCUMENT_SUBMITTED` | `"DOCUMENT_SUBMITTED"` | Patient uploads a document to private storage and logs it in [submitDocumentAction](file:///c:/Users/johnr/Desktop/Klinikaid/src/app/(dashboard)/patient/submit/actions.ts). |
| `PRIVACY_ACCEPTED` | `"PRIVACY_ACCEPTED"` | Patient accepts the DPA Republic Act 10173 consent form in [acceptPrivacyAction](file:///c:/Users/johnr/Desktop/Klinikaid/src/app/(auth)/privacy-agreement/actions.ts). |
| `QUEUE_COMPLETED` | `"QUEUE_COMPLETED"` | Department records entry workflow completes a patient's waitlist queue status. |
| `MFA_ENROLLED` | `"MFA_ENROLLED"` | Staff user completes their TOTP MFA authenticator factor enrollment and verification. |

