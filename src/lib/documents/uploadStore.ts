import type { SupabaseClient } from "@supabase/supabase-js";
import {
  UploadError,
  type StoredObjectEntry,
  type UploadStore,
} from "@/lib/documents/uploadSubmission";

/**
 * Wraps one store call, for latency labels. The web caller passes its `timed`
 * helper; the Edge Function leaves the default, so this module never imports
 * the Next.js-only timing code (#240).
 */
export type StoreTimer = <T>(name: string, fn: () => PromiseLike<T>) => Promise<T>;
const untimed: StoreTimer = (_name, fn) => Promise.resolve(fn());

export function uploadStore(admin: SupabaseClient, timer: StoreTimer = untimed): UploadStore {
  const bucket = () => admin.storage.from("patient-documents");
  return {
    async pending(userId, assessmentId) {
      return timer("confirm: pending row", async () => {
        const { data, error } = await admin.from("pending_document_ocr")
          .select("id,user_id,patient_id,file_name,file_type,file_path,ocr_text")
          .eq("id", assessmentId).eq("user_id", userId).maybeSingle();
        if (error) throw new UploadError("SERVER_ERROR");
        return data;
      });
    },
    async listing(userId, assessmentId) {
      // The assessment's folder holds only its source file, so no name search is needed.
      return timer("confirm: storage listing", async () => {
        const { data, error } = await bucket().list(
          `${userId}/pending-submissions/${assessmentId}`,
          { limit: 100 },
        );
        if (error) throw new UploadError("SERVER_ERROR");
        return data ?? [];
      });
    },
    async file(path, entry: StoredObjectEntry | undefined) {
      if (!entry?.id || !entry.metadata) return null;
      // Refuse an oversized object before pulling it into the function's memory.
      const size = Number(entry.metadata.size);
      if (!Number.isFinite(size) || size < 1 || size > 5 * 1024 * 1024) {
        return null;
      }
      const { data, error } = await timer("confirm: storage download", () =>
        bucket().download(path)
      );
      if (error || !data) throw new UploadError("SERVER_ERROR");
      return Object.assign(data, {
        objectSnapshot: { id: entry.id, metadata: entry.metadata },
      });
    },
    async submit(input) {
      const { data, error } = await admin.rpc("submit_patient_upload", {
        p_user_id: input.user_id,
        p_patient_id: input.patient_id,
        p_request_id: input.request_id,
        p_assessment_id: input.assessment_id,
        p_fingerprint: input.fingerprint,
        p_metadata: input.metadata,
        p_pending: input.pending,
        p_object_snapshot: input.object_snapshot,
      });
      if (error || !data) throw new UploadError("SERVER_ERROR");
      return data;
    },
    async lookup(userId, requestId) {
      const { data, error } = await admin.rpc("submit_patient_upload_outcome", {
        p_user_id: userId,
        p_request_id: requestId,
      });
      if (error || !data) throw new UploadError("SERVER_ERROR");
      return data;
    },
  };
}
