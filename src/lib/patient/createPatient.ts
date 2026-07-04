import { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/logger";
import crypto from "crypto";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";

export interface CreatePatientInput {
  email: string;
  password?: string;
  firstName: string;
  lastName: string;
  dob: string;
  gender: "male" | "female" | "other";
  contactNumber: string;
  address: string;
}

export interface CreatePatientResult {
  success: boolean;
  userId?: string;
  patientId?: string;
  passwordUsed?: string;
  error?: string;
  emailPending?: boolean;
}

/**
 * Centralized function to handle patient creation.
 * Creates auth user, auto-triggers profile generation, and inserts patient record.
 * Uses admin/service role client to insert to public.patients since patients/anonymous users lack insert RLS.
 */
export async function createPatient(
  client: SupabaseClient,
  input: CreatePatientInput,
  isReceptionistCreated: boolean,
  receptionistId?: string | null
): Promise<CreatePatientResult> {
  const { email, password, firstName, lastName, dob, gender, contactNumber, address } = input;
  const fullName = `${firstName} ${lastName}`;
  const adminClient = createAdminClient();

  let userId: string | undefined;
  let passwordUsed = password;
  let emailPendingConfirmation = false;

  try {
    if (isReceptionistCreated) {
      // 1. Receptionist Branch: Create Auth user with admin client (prevents receptionist session logout)
      if (!passwordUsed) {
        // Generate cryptographically secure random password if none provided
        passwordUsed = crypto.randomBytes(8).toString("hex") + "A1!";
      }

      const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
        email,
        password: passwordUsed,
        email_confirm: true,
        user_metadata: {
          role: "patient",
          full_name: fullName,
        },
      });

      if (authError || !authData.user) {
        return {
          success: false,
          error: authError?.message || "Failed to create user in authentication database.",
        };
      }
      userId = authData.user.id;
    } else {
      // 2. Self-Registration Branch: Sign up user using standard client (sets session cookies)
      if (!passwordUsed) {
        return {
          success: false,
          error: "Password is required for self-registration.",
        };
      }

      const { data: authData, error: authError } = await client.auth.signUp({
        email,
        password: passwordUsed,
        options: {
          data: {
            role: "patient",
            full_name: fullName,
          },
        },
      });

      // Branch A — hard auth error (password policy, etc.)
      if (authError) {
        const isUserFacing = authError.status !== 500 && !!authError.message;
        return {
          success: false,
          error: isUserFacing
            ? authError.message
            : "Registration is currently unavailable. Please try again later.",
        };
      }

      // Branch B — obfuscated / rate-limited (user null, no error)
      if (!authData.user) {
        return {
          success: false,
          error:
            "Registration is temporarily unavailable, or this email may already be registered. Please try again later, use the login page, or contact the clinic.",
        };
      }

      // Branch C — confirm-email pending (user set, session null)
      // Branch D — session present (Confirm email OFF)
      // Both: set userId and emailPendingConfirmation flag; fall through to patients insert.
      emailPendingConfirmation = !authData.session;
      userId = authData.user.id;
    }

    // 3. Insert linked patients record using adminClient (RLS requires admin/receptionist)
    const { data: patientData, error: patientError } = await adminClient
      .from("patients")
      .insert({
        profile_id: userId,
        first_name: firstName,
        last_name: lastName,
        date_of_birth: dob,
        gender,
        contact_number: contactNumber,
        address,
        email,
      })
      .select("id")
      .single();

    if (patientError) {
      // 4. Split Partial-Failure Handling
      // Delete auth user to prevent orphaned auth record.
      await adminClient.auth.admin.deleteUser(userId);

      if (isReceptionistCreated) {
        // Receptionist failure logging
        await logEvent(
          adminClient,
          receptionistId || null,
          SYSTEM_EVENT_TYPES.STAFF_ACTION_FAILED,
          `Receptionist failed to create patient: DB insert failed for ${email} - ${patientError.message}`
        );
        return {
          success: false,
          error: `Database registration error: ${patientError.message}`,
        };
      } else {
        // Self-registration failure logging
        return {
          success: false,
          error: "Registration failed. We were unable to set up your patient record. Please try again.",
        };
      }
    }

    // 5. Log success event and return result
    const logMessage = isReceptionistCreated
      ? `Patient registered by receptionist: ${fullName} (${email})`
      : `Patient registered via self-registration: ${fullName} (${email})`;

    await logEvent(adminClient, userId, SYSTEM_EVENT_TYPES.USER_REGISTERED, logMessage);

    return {
      success: true,
      userId,
      patientId: patientData.id,
      passwordUsed,
      emailPending: emailPendingConfirmation,
    };
  } catch (err: unknown) {
    // Top-level fallback cleanup
    if (userId) {
      try {
        await adminClient.auth.admin.deleteUser(userId);
      } catch {}
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "An unexpected error occurred during patient creation.",
    };
  }
}
