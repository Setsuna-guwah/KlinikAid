import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/helpers";
import { errorResponse, successResponse } from "@/lib/api-response";
import { logEvent } from "@/lib/logger";
import { getPhtStartOfToday } from "@/lib/utils";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";

const STRICT_NUMBER_REGEX = /^-?\d+(\.\d+)?$/;
const BLOOD_PRESSURE_REGEX = /^\d{2,3}\/\d{2,3}$/;

function normalizeOptionalString(value: unknown) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function parseOptionalWeight(value: unknown): { valid: boolean; value: number | null; error?: string } {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return { valid: true, value: null };

  if (!STRICT_NUMBER_REGEX.test(normalized)) {
    return { valid: false, value: null, error: "Weight must be a valid positive number below 500 kg." };
  }

  const numericValue = Number(normalized);
  if (!Number.isFinite(numericValue) || numericValue <= 0 || numericValue >= 500) {
    return { valid: false, value: null, error: "Weight must be a valid positive number below 500 kg." };
  }

  return { valid: true, value: numericValue };
}

function parseOptionalTemperature(value: unknown): { valid: boolean; value: number | null; error?: string } {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return { valid: true, value: null };

  if (!STRICT_NUMBER_REGEX.test(normalized)) {
    return { valid: false, value: null, error: "Temperature must be between 30°C and 45°C." };
  }

  const numericValue = Number(normalized);
  if (!Number.isFinite(numericValue) || numericValue < 30 || numericValue > 45) {
    return { valid: false, value: null, error: "Temperature must be between 30°C and 45°C." };
  }

  return { valid: true, value: numericValue };
}

export async function POST(request: Request) {
  const supabase = createClient();

  // 1. Session Check (Rule 1)
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    // 2. Role Check (Rule 2)
    const profile = await requirePermission("queue.manage");

    // 3. Parse and validate body
    const body = await request.json();
    const { patient_id, department, notes, vitals, priority_level } = body;

    if (!patient_id) {
      return errorResponse("patient_id is required", 400);
    }
    if (!department || !["laboratory", "imaging", "ultrasound", "ecg"].includes(department)) {
      return errorResponse("Valid department ('laboratory', 'imaging', 'ultrasound', 'ecg') is required", 400);
    }

    const bloodPressure = normalizeOptionalString(vitals?.blood_pressure);
    if (bloodPressure && !BLOOD_PRESSURE_REGEX.test(bloodPressure)) {
      return errorResponse("Blood pressure format must be e.g. 120/80", 400);
    }

    const weight = parseOptionalWeight(vitals?.weight_kg);
    if (!weight.valid) {
      return errorResponse(weight.error || "Invalid weight.", 400);
    }

    const temperature = parseOptionalTemperature(vitals?.temperature_c);
    if (!temperature.valid) {
      return errorResponse(temperature.error || "Invalid temperature.", 400);
    }

    // 3.5. Guard Check: Deduplicate Triage Approvals
    // Check if patient already has an open (waiting or in_progress) queue entry
    const { data: existingOpen, error: checkError } = await supabase
      .from("patient_queue")
      .select("id, department, status")
      .eq("patient_id", patient_id)
      .in("status", ["waiting", "in_progress"])
      .limit(1)
      .maybeSingle();

    if (checkError) {
      throw checkError;
    }

    if (existingOpen) {
      // Map department identifier to a human-readable title
      const deptNames: Record<string, string> = {
        laboratory: "Laboratory",
        imaging: "Imaging",
        ultrasound: "Ultrasound",
        ecg: "ECG",
      };
      const deptLabel = deptNames[existingOpen.department] || existingOpen.department;
      return errorResponse(
        `Patient already in ${deptLabel} queue. Resolve the existing entry before routing a new one.`,
        409
      );
    }

    // 4. Calculate Philippine start of today (UTC+8) (Rule 9)
    const startOfTodayIso = getPhtStartOfToday();

    // 5. Query today's queue entries for this department to calculate queue number
    const { count, error: countError } = await supabase
      .from("patient_queue")
      .select("id", { count: "exact", head: true })
      .eq("department", department)
      .gte("created_at", startOfTodayIso);

    if (countError) {
      throw countError;
    }

    const dailyCount = (count || 0) + 1;

    // 6. Map department to code
    const deptCodes: Record<string, string> = {
      laboratory: "LAB",
      imaging: "IMG",
      ultrasound: "ULT",
      ecg: "ECG",
    };
    const deptCode = deptCodes[department] || "GEN";
    const queueNumber = `${deptCode}-${String(dailyCount).padStart(3, "0")}`;

    // 7. Format triage_notes as JSON (as established in Phase 4 / MASTER_CONTEXT.md)
    const triageNotesJson = JSON.stringify({
      queue_number: queueNumber,
      vitals: {
        blood_pressure: bloodPressure || null,
        weight_kg: weight.value,
        temperature_c: temperature.value,
      },
      notes: notes || "",
    });

    // 8. Insert into patient_queue
    const { data: queueEntry, error: insertError } = await supabase
      .from("patient_queue")
      .insert({
        patient_id,
        department,
        status: "waiting", // satisfies CHECK (status IN ('waiting', 'in_progress', 'completed', 'cancelled'))
        priority_level: priority_level || "routine",
        triage_notes: triageNotesJson,
      })
      .select(`
        *,
        patient:patient_id (
          id,
          first_name,
          last_name
        )
      `)
      .single();

    if (insertError || !queueEntry) {
      throw insertError || new Error("Failed to insert queue record");
    }

    await logEvent(
      supabase,
      user.id,
      SYSTEM_EVENT_TYPES.TRIAGE_COMPLETED,
      `Patient ${queueEntry.patient?.first_name} ${queueEntry.patient?.last_name} routed to ${department} with queue #${queueNumber}`,
      null,
      {
        queue_id: queueEntry.id,
        patient_id,
        department,
        queue_number: queueNumber,
        assigned_by: user.id,
        assigned_by_name: profile.full_name,
      }
    );

    // Return the response including the queue entry and computed queue_number
    return successResponse(
      {
        ...queueEntry,
        queue_number: queueNumber,
      },
      "Patient routed and triaged successfully"
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse("Failed to complete triage routing", 500, message);
  }
}
