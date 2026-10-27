import { CLINIC_TEMPLATES } from "@/lib/documentTemplates";
import {
  detectRequestedTests,
  selectDetectedTests,
} from "@/lib/documents/detectRequestedTests";

export type UploadInput = {
  request_id: string;
  assessment_id: string;
  document_type: string;
  selected_test_ids?: string[];
};
export type PendingUpload = {
  id: string;
  user_id: string;
  patient_id: string;
  file_name: string;
  file_type: string;
  file_path: string;
  ocr_text: string;
};
export type UploadOutcome =
  | { outcome: "created" | "replayed"; document_id: string }
  | { outcome: "duplicate"; document_id: string; status: string }
  | {
    outcome:
      | "conflict"
      | "expired"
      | "withdrawn"
      | "assessment_not_found"
      | "file_invalid";
  };
export type UploadLookup =
  | {
    state: "committed";
    document_id: string;
    status: string;
    first_accepted_at: string;
    replayable: boolean;
  }
  | { state: "withdrawn"; first_accepted_at: string }
  | { state: "not_found" };
export type StoredUploadFile = Blob & {
  objectSnapshot: { id: string; metadata: Record<string, unknown> };
};
export type StoredObjectEntry = {
  name: string;
  id?: string | null;
  metadata?: Record<string, unknown> | null;
};
export interface UploadStore {
  pending(userId: string, assessmentId: string): Promise<PendingUpload | null>;
  // Objects in the assessment's own folder. Read alongside `pending` (#240): the
  // folder is known from the request, so the file's path need not be read first.
  listing(userId: string, assessmentId: string): Promise<StoredObjectEntry[]>;
  file(path: string, entry: StoredObjectEntry | undefined): Promise<StoredUploadFile | null>;
  submit(
    input: {
      user_id: string;
      patient_id: string;
      request_id: string;
      assessment_id: string;
      fingerprint: string;
      metadata: Record<string, unknown>;
      pending: PendingUpload | null;
      object_snapshot: StoredUploadFile["objectSnapshot"] | null;
    },
  ): Promise<UploadOutcome>;
  lookup(userId: string, requestId: string): Promise<UploadLookup>;
}
export class UploadError extends Error {
  constructor(
    public code:
      | "FIELD_INVALID"
      | "FIELD_REQUIRED"
      | "UNKNOWN_FIELD"
      | "SERVER_ERROR"
      | "ASSESSMENT_NOT_FOUND"
      | "DUPLICATE_PENDING"
      | "IDEMPOTENCY_CONFLICT"
      | "RECONCILIATION_REQUIRED",
    public field?: string,
    public extra?: Record<string, string>,
  ) {
    super(code);
  }
}
export const uploadUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseUpload(value: unknown): UploadInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UploadError("FIELD_INVALID", "body");
  }
  const raw = value as Record<string, unknown>;
  if (
    Object.keys(raw).some((k) =>
      !["request_id", "assessment_id", "document_type", "selected_test_ids"]
        .includes(k)
    )
  ) throw new UploadError("UNKNOWN_FIELD", "body");
  for (const field of ["request_id", "assessment_id"]) {
    if (
      typeof raw[field] !== "string" || !uploadUuid.test(raw[field] as string)
    ) throw new UploadError("FIELD_INVALID", field);
  }
  const category = raw.document_type ?? "other";
  if (
    typeof category !== "string" ||
    !["other", ...CLINIC_TEMPLATES.map((t) => t.id)].includes(category)
  ) throw new UploadError("FIELD_INVALID", "document_type");
  const selected = raw.selected_test_ids;
  if (
    selected !== undefined &&
    (!Array.isArray(selected) || selected.length > 100 ||
      selected.some((x) => typeof x !== "string" || x.length > 100))
  ) throw new UploadError("FIELD_INVALID", "selected_test_ids");
  return {
    request_id: (raw.request_id as string).toLowerCase(),
    assessment_id: (raw.assessment_id as string).toLowerCase(),
    document_type: category,
    ...(selected !== undefined
      ? { selected_test_ids: [...new Set(selected as string[])].sort() }
      : {}),
  };
}
export async function uploadFingerprint(input: UploadInput): Promise<string> {
  // The assessment identity is immutable content; selection order is irrelevant.
  const content = JSON.stringify([
    input.assessment_id,
    input.document_type,
    input.selected_test_ids ?? null,
  ]);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(content),
  );
  return Array.from(
    new Uint8Array(digest),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
export function validPendingPath(row: PendingUpload, userId: string): boolean {
  const ext = row.file_type === "application/pdf"
    ? "pdf"
    : row.file_type === "image/png"
    ? "png"
    : row.file_type === "image/jpeg"
    ? "jpe?g"
    : null;
  return ext !== null &&
    new RegExp(`^${userId}/pending-submissions/${row.id}/source\\.${ext}$`)
      .test(row.file_path);
}
// Web's OCR text is produced on the server; mobile writes its own pending row,
// so its detected tests come from client OCR and are labelled as such.
export type DetectionSource =
  | "ocr_text_catalog_match"
  | "client_ocr_catalog_match";
export async function submitUpload(
  store: UploadStore,
  userId: string,
  patientId: string,
  input: UploadInput,
  detectionSource: DetectionSource,
) {
  // The row and the folder listing are independent reads, so they run together.
  // A listing failure only matters once a row exists (checked below), as before.
  const [row, listing] = await Promise.all([
    store.pending(userId, input.assessment_id),
    store.listing(userId, input.assessment_id).catch(() => null),
  ]);
  const metadata: Record<string, unknown> = {
    document_type: input.document_type,
  };
  let objectSnapshot: StoredUploadFile["objectSnapshot"] | null = null;
  if (row) {
    if (
      row.user_id !== userId || row.patient_id !== patientId ||
      row.id !== input.assessment_id
    ) throw new UploadError("ASSESSMENT_NOT_FOUND");
    if (!validPendingPath(row, userId)) {
      throw new UploadError("FIELD_INVALID", "file");
    }
    if (listing === null) throw new UploadError("SERVER_ERROR");
    // validPendingPath pins the name to `source.<ext>` inside the assessment folder.
    const name = row.file_path.slice(row.file_path.lastIndexOf("/") + 1);
    const file = await store.file(row.file_path, listing.find((entry) => entry.name === name));
    if (
      !file || file.size < 1 || file.size > 5 * 1024 * 1024 ||
      file.type.split(";")[0] !== row.file_type
    ) throw new UploadError("FIELD_INVALID", "file");
    objectSnapshot = file.objectSnapshot;
    if (!objectSnapshot?.id || !objectSnapshot.metadata) {
      throw new UploadError("SERVER_ERROR");
    }
    const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const valid = row.file_type === "application/pdf"
      ? new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-"
      : row.file_type === "image/png"
      ? [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!valid) throw new UploadError("FIELD_INVALID", "file");
    const detected = detectRequestedTests(row.ocr_text);
    const selected = selectDetectedTests(detected, input.selected_test_ids);
    if (detected.length && !selected.length) {
      throw new UploadError("FIELD_REQUIRED", "selected_test_ids");
    }
    if (detected.length) {
      Object.assign(metadata, {
        detected_tests: detected,
        selected_tests: selected,
        test_detection_source: detectionSource,
        test_detection_version: 1,
      });
    }
  }
  // Even with no pending row, the transaction must check a retained receipt.
  const outcome = await store.submit({
    user_id: userId,
    patient_id: patientId,
    request_id: input.request_id,
    assessment_id: input.assessment_id,
    fingerprint: await uploadFingerprint(input),
    metadata,
    pending: row,
    object_snapshot: objectSnapshot,
  });
  switch (outcome.outcome) {
    case "created":
    case "replayed":
      if (!outcome.document_id) throw new UploadError("SERVER_ERROR");
      return {
        document_id: outcome.document_id,
        status: "pending",
        replayed: outcome.outcome === "replayed",
      };
    case "duplicate":
      throw new UploadError("DUPLICATE_PENDING", undefined, {
        document_id: outcome.document_id,
        status: outcome.status,
      });
    case "conflict":
      throw new UploadError("IDEMPOTENCY_CONFLICT");
    case "expired":
    case "withdrawn":
      throw new UploadError("RECONCILIATION_REQUIRED");
    case "assessment_not_found":
      throw new UploadError("ASSESSMENT_NOT_FOUND");
    case "file_invalid":
      throw new UploadError("FIELD_INVALID", "file");
    default:
      throw new UploadError("SERVER_ERROR");
  }
}
