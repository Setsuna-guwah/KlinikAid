"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/helpers";
import { logEvent } from "@/lib/logger";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";
import { validateLabResult } from "@/lib/records/validateLabResult";
import { revalidatePath } from "next/cache";

export interface RecordResult {
  success: boolean;
  error?: string;
}

export interface SpecialistRecordPayload {
  test_type: string;
  notes: string;
  results: {
    test_name: string;
    test_value: string;
  }[];
}

export async function createSpecialistRecordAction(
  patientId: string,
  payload: SpecialistRecordPayload
): Promise<RecordResult> {
  const supabase = createClient();

  try {
    const profile = await requirePermission("specialist.records");

    if (!patientId || !payload.test_type || !payload.results || payload.results.length === 0) {
      return { success: false, error: "Missing required record data" };
    }

    // 1. Fetch private specialist patient and verify owner containment
    const { data: patient, error: patientError } = await supabase
      .from("specialist_patients")
      .select("id, gender, specialist_id")
      .eq("id", patientId)
      .single();

    if (patientError || !patient) {
      return { success: false, error: "Patient record not found or access denied." };
    }

    if (patient.specialist_id !== profile.id) {
      return { success: false, error: "Unauthorized: Patient does not belong to your private roster." };
    }

    // 2. Map results, validate numeric values, and calculate flagged states server-side.
    const recordsToInsert = payload.results.map((r) => {
      const validated = validateLabResult(r.test_name, r.test_value, patient.gender);

      return {
        specialist_patient_id: patientId,
        specialist_id: profile.id,
        test_type: payload.test_type,
        test_name: r.test_name,
        test_value: validated.test_value,
        unit: validated.unit,
        reference_range_min: validated.reference_range_min,
        reference_range_max: validated.reference_range_max,
        is_flagged: validated.is_flagged,
        notes: payload.notes || null,
      };
    });

    const { error: insertError } = await supabase
      .from("specialist_records")
      .insert(recordsToInsert);

    if (insertError) {
      throw insertError;
    }

    // 3. Log event (no PII in metadata)
    await logEvent(
      supabase,
      profile.id,
      SYSTEM_EVENT_TYPES.SPECIALIST_RECORD_ENTERED,
      "Specialist entered a private clinical record",
      null,
      { patient_id: patientId, test_type: payload.test_type }
    );

    revalidatePath(`/specialist/patients/${patientId}/analytics`);
    revalidatePath("/specialist/patients");
    return { success: true };
  } catch (err: unknown) {
    console.error("Failed to save specialist record:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to save record.",
    };
  }
}
