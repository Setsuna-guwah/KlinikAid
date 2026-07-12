export type UserRole = "admin" | "receptionist" | "department_staff" | "medical_specialist" | "patient";
export type Department = "laboratory" | "imaging" | "ultrasound" | "ecg";
export type QueueStatus = "waiting" | "in_progress" | "completed" | "cancelled";
export type PriorityLevel = "routine" | "urgent" | "emergency";
export type DocumentStatus = "pending" | "approved" | "rejected";
export type ReferenceRangeStatus = "normal" | "critical_high" | "critical_low" | "inconclusive";
export type FeedbackType = "helpful" | "unhelpful";

export interface Profile {
  id: string;
  full_name: string;
  role: UserRole;
  department: Department | null;
  employee_type: string | null;
  created_at: string;
  updated_at: string;
}

export interface Patient {
  id: string;
  profile_id: string | null;
  first_name: string;
  last_name: string;
  date_of_birth: string; // ISO date string (YYYY-MM-DD)
  gender: "male" | "female" | "other";
  contact_number: string;
  email: string | null;
  address: string;
  created_at: string;
  updated_at: string;
}

export interface PatientQueue {
  id: string; // Bigint from DB, usually serialized as string or number
  patient_id: string;
  status: QueueStatus;
  department: Department;
  triage_notes: string | null;
  priority_level: PriorityLevel;
  estimated_wait_minutes: number | null;
  created_at: string;
  updated_at: string;
  patient?: Patient; // Optional pre-fetched relation
}

export interface Document {
  id: string;
  patient_id: string | null;
  uploader_id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  status: DocumentStatus;
  ocr_text: string | null;
  extracted_metadata: Record<string, unknown> | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
  uploader?: Profile; // Optional relation
  patient?: Patient;  // Optional relation
}

export interface DepartmentRecord {
  id: string;
  patient_id: string;
  recorder_id: string;
  department: Department;
  test_type: string;
  test_name: string;
  test_value: string;
  unit: string | null;
  reference_range_min: number | null;
  reference_range_max: number | null;
  is_flagged: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  patient?: Patient;   // Optional relation
  recorder?: Profile;  // Optional relation
}

export interface SystemLog {
  id: string;
  user_id: string | null;
  event_type: string;
  description: string;
  ip_address: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  user?: Profile; // Optional relation
}

export interface ChatbotLog {
  id: string;
  user_id: string | null;
  session_id: string;
  user_message: string;
  bot_response: string;
  tokens_used: number;
  feedback: FeedbackType | null;
  created_at: string;
}

export interface RagDocument {
  id: string;
  title: string;
  content: string;
  embedding: number[]; // 768 dimension array
  metadata: Record<string, unknown> | null;
  created_at: string;
}
