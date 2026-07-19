"use server";

import { createClient } from "@/lib/supabase/server";
import { createPatient } from "@/lib/patient/createPatient";
import { hasPermission } from "@/lib/auth/helpers";
import { validateAge, validateName, CONTACT_REQUIREMENT_TEXT, validateContactNumber } from "@/lib/validation";
import { z } from "zod";

const receptionPatientSchema = z.object({
  email: z.string().email("Invalid email address"),
  firstName: z.string().refine((v) => validateName(v, "First name").valid, {
    message: "First name must be at least 3 characters and contain only letters, spaces, hyphens, apostrophes, or periods."
  }),
  lastName: z.string().refine((v) => validateName(v, "Last name").valid, {
    message: "Last name must be at least 3 characters and contain only letters, spaces, hyphens, apostrophes, or periods."
  }),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date of birth format"),
  gender: z.enum(["male", "female", "other"], { message: "Select a valid gender" }),
  contactNumber: z.string().refine((v) => validateContactNumber(v).valid, CONTACT_REQUIREMENT_TEXT),
  address: z.string().min(1, "Address is required"),
});

export interface ReceptionPatientResult {
  error?: string;
  success?: boolean;
  passwordUsed?: string;
}

export async function createPatientByStaffAction(
  prevState: unknown,
  formData: FormData
): Promise<ReceptionPatientResult> {
  // 1. Authenticate receptionist session (Rule 1)
  const client = createClient();
  const { data: { user }, error: authError } = await client.auth.getUser();

  if (authError || !user) {
    return { error: "Unauthorized. Session expired." };
  }

  if (!(await hasPermission(user.id, "patients.manage"))) {
    return { error: "Unauthorized. Front desk privileges required." };
  }

  // 2. Extract and Validate Form Data
  const email = formData.get("email") as string;
  const firstName = formData.get("firstName") as string;
  const lastName = formData.get("lastName") as string;
  const dob = formData.get("dob") as string;
  const gender = formData.get("gender") as string;
  const contactNumber = formData.get("contactNumber") as string;
  const address = formData.get("address") as string;

  const validation = receptionPatientSchema.safeParse({
    email,
    firstName,
    lastName,
    dob,
    gender,
    contactNumber,
    address,
  });

  if (!validation.success) {
    return { error: validation.error.issues.map((e) => e.message).join(". ") };
  }

  const ageValidation = validateAge(dob);
  if (!ageValidation.valid) {
    return { error: ageValidation.error || "Invalid date of birth." };
  }

  // 3. Invoke Patient Creation
  const res = await createPatient(
    client,
    {
      email,
      firstName,
      lastName,
      dob,
      gender: gender as "male" | "female" | "other",
      contactNumber,
      address,
    },
    true, // Receptionist-led patient registration
    user.id // Pass receptionist user ID for audit log tracking
  );

  if (!res.success || res.error) {
    return { error: res.error || "Failed to create patient account." };
  }

  return {
    success: true,
    passwordUsed: res.passwordUsed,
  };
}
