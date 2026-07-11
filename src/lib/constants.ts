import { UserRole, Department, DocumentStatus, QueueStatus, ReferenceRangeStatus } from "@/types";

export const USER_ROLES: Record<UserRole, { label: string; color: string }> = {
  admin: { label: "Administrator", color: "bg-red-500 text-white dark:bg-red-600" },
  receptionist: { label: "Receptionist", color: "bg-accentBlue-500 text-white dark:bg-accentBlue-600" },
  department_staff: { label: "Department Staff", color: "bg-purple-500 text-white dark:bg-purple-600" },
  medical_specialist: { label: "Medical Specialist", color: "bg-indigo-500 text-white dark:bg-indigo-600" },
  patient: { label: "Patient", color: "bg-green-500 text-white dark:bg-green-600" },
};

export const DEPARTMENTS: Record<Department, { label: string; color: string; path: string }> = {
  laboratory: { label: "Laboratory", color: "bg-emerald-500 text-white dark:bg-emerald-600", path: "laboratory" },
  imaging: { label: "Imaging (X-Ray)", color: "bg-amber-500 text-white dark:bg-amber-600", path: "imaging" },
  ultrasound: { label: "Ultrasound", color: "bg-teal-500 text-white dark:bg-teal-600", path: "ultrasound" },
  ecg: { label: "ECG", color: "bg-rose-500 text-white dark:bg-rose-600", path: "ecg" },
};

export const DOCUMENT_STATUSES: Record<DocumentStatus, { label: string; color: string }> = {
  pending: { label: "Pending Review", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" },
  approved: { label: "Approved", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  rejected: { label: "Rejected", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
};

export const QUEUE_STATUSES: Record<QueueStatus, { label: string; color: string }> = {
  waiting: { label: "Waiting", color: "bg-accentBlue-100 text-accentBlue-800 dark:bg-accentBlue-900/30 dark:text-accentBlue-400" },
  in_progress: { label: "In Progress", color: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400" },
  completed: { label: "Completed", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  cancelled: { label: "Cancelled", color: "bg-gray-100 text-gray-800 dark:bg-gray-800/30 dark:text-gray-400" },
};

export const REFERENCE_RANGE_STATUSES: Record<ReferenceRangeStatus, { label: string; color: string }> = {
  normal: { label: "Normal", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  critical_high: { label: "Critical High", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
  critical_low: { label: "Critical Low", color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400" },
  inconclusive: { label: "Inconclusive", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" },
};

/**
 * Standard Lab Medical Reference Ranges (Bloodcare Medical Laboratory context)
 * Used to automatically flag out-of-range results in dashboards.
 */
export interface LabReferenceRange {
  parameter: string;
  unit: string;
  maleMin: number;
  maleMax: number;
  femaleMin: number;
  femaleMax: number;
  description: string;
}

export const LAB_REFERENCE_RANGES: LabReferenceRange[] = [
  {
    parameter: "Hemoglobin",
    unit: "g/dL",
    maleMin: 13.5,
    maleMax: 17.5,
    femaleMin: 12.0,
    femaleMax: 15.5,
    description: "Iron-containing oxygen-transport metalloprotein in red blood cells"
  },
  {
    parameter: "White Blood Cells (WBC)",
    unit: "x10^3/µL",
    maleMin: 4.5,
    maleMax: 11.0,
    femaleMin: 4.5,
    femaleMax: 11.0,
    description: "Cells of the immune system involved in protecting the body"
  },
  {
    parameter: "Platelets",
    unit: "x10^3/µL",
    maleMin: 150,
    maleMax: 450,
    femaleMin: 150,
    femaleMax: 450,
    description: "Cells that help blood clot"
  },
  {
    parameter: "Fasting Blood Sugar (FBS)",
    unit: "mg/dL",
    maleMin: 70,
    maleMax: 100,
    femaleMin: 70,
    femaleMax: 100,
    description: "Measures blood glucose after an 8-hour fast"
  },
  {
    parameter: "Creatinine",
    unit: "mg/dL",
    maleMin: 0.6,
    maleMax: 1.2,
    femaleMin: 0.5,
    femaleMax: 1.1,
    description: "Waste product filtered by kidneys; indicator of renal function"
  },
  {
    parameter: "Cholesterol",
    unit: "mg/dL",
    maleMin: 100,
    maleMax: 200,
    femaleMin: 100,
    femaleMax: 200,
    description: "Total lipid marker"
  }
];

export const CHART_COLORS = {
  laboratory: '#0D7C66',  // teal — primary brand color
  xray:       '#7C3AED',  // purple
  ultrasound: '#0891B2',  // cyan
  ecg:        '#EA580C',  // orange
  flagged:    '#DC2626',  // red — out-of-range values
  normal:     '#16A34A',  // green — within normal range
  normalBand: '#16A34A',  // green fill for reference area (use with low opacity)
  primary:    '#0D7C66',  // default line/bar color
  muted:      '#94A3B8',  // gray — secondary data
};

// Gemini 2.5 Flash official pricing (Google, May 2026): $0.30/1M input, $2.50/1M output.
// chatbot_logs.tokens_used is the COMBINED total, so a single blended rate is used.
// Blend assumes a RAG workload of ~85% input / ~15% output tokens:
//   0.85 * 0.30 + 0.15 * 2.50 = 0.63 USD per 1M tokens. Edit the blend if the ratio shifts.
export const GEMINI_BLENDED_USD_PER_1M_TOKENS = 0.63;

export const SYSTEM_EVENT_TYPES = {
  LOGIN_SUCCESS:          "LOGIN_SUCCESS",
  LOGIN_FAILED:           "LOGIN_FAILED",
  LOGOUT:                 "LOGOUT",
  USER_REGISTERED:        "USER_REGISTERED",
  STAFF_CREATED:          "STAFF_CREATED",
  STAFF_UPDATED:          "STAFF_UPDATED",
  STAFF_ACTIVATED:        "STAFF_ACTIVATED",
  STAFF_DEACTIVATED:      "STAFF_DEACTIVATED",
  DOCUMENT_APPROVED:      "DOCUMENT_APPROVED",
  DOCUMENT_REJECTED:      "DOCUMENT_REJECTED",
  TRIAGE_COMPLETED:       "TRIAGE_COMPLETED",
  RECORD_ENTERED:         "RECORD_ENTERED",
  RAG_DOCUMENT_UPLOADED:  "RAG_DOCUMENT_UPLOADED",
  RAG_DOCUMENT_DELETED:   "RAG_DOCUMENT_DELETED",
  ACCESS_DENIED:          "ACCESS_DENIED",
  EXPORT_SYSTEM_LOGS:     "EXPORT_SYSTEM_LOGS",
  STAFF_ACTION_FAILED:    "STAFF_ACTION_FAILED",
  DOCUMENT_SUBMITTED:     "DOCUMENT_SUBMITTED",
  PRIVACY_ACCEPTED:       "PRIVACY_ACCEPTED",
  QUEUE_COMPLETED:        "QUEUE_COMPLETED",
  MFA_ENROLLED:           "MFA_ENROLLED",
  PASSWORD_CHANGED:       "PASSWORD_CHANGED",
  PROFILE_UPDATED:        "PROFILE_UPDATED",
  SPECIALIST_PATIENT_CREATED: "SPECIALIST_PATIENT_CREATED",
  SPECIALIST_RECORD_ENTERED: "SPECIALIST_RECORD_ENTERED",
} as const;

export const WEB_OCR_ENABLED = false;

export const SITE_ORIGIN =
  process.env.NODE_ENV === "development"
    ? "http://localhost:3000"
    : "https://www.klinikaid.com";


