"use server";

import { createClient } from "@/lib/supabase/server";
import { createPatient } from "@/lib/patient/createPatient";
import { PASSWORD_REQUIREMENT_TEXT, validateAge, validatePassword, validateName, CONTACT_REQUIREMENT_TEXT, validateContactNumber } from "@/lib/validation";
import { z } from "zod";

const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().refine(validatePassword, PASSWORD_REQUIREMENT_TEXT),
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

export interface RegisterResult {
  error?: string;
  success?: boolean;
  redirectUrl?: string;
  emailPending?: boolean;
  registeredEmail?: string;
}

export async function registerAction(
  prevState: RegisterResult | null,
  formData: FormData
): Promise<RegisterResult> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const firstName = formData.get("firstName") as string;
  const lastName = formData.get("lastName") as string;
  const dob = formData.get("dob") as string;
  const gender = formData.get("gender") as string;
  const contactNumber = formData.get("contactNumber") as string;
  const address = formData.get("address") as string;

  // 1. Zod Validation
  const validation = registerSchema.safeParse({
    email,
    password,
    firstName,
    lastName,
    dob,
    gender,
    contactNumber,
    address,
  });

  if (!validation.success) {
    const errorMsg = validation.error.issues.map((e) => e.message).join(". ");
    return { error: errorMsg };
  }

  const ageValidation = validateAge(dob);
  if (!ageValidation.valid) {
    return { error: ageValidation.error || "Invalid date of birth." };
  }

  // 2. Initialize Client
  const client = createClient();

  // 3. Call Centralized Patient Creator
  const res = await createPatient(
    client,
    {
      email,
      password,
      firstName,
      lastName,
      dob,
      gender: gender as "male" | "female" | "other",
      contactNumber,
      address,
    },
    false // Self-registration pathway
  );

  if (!res.success || res.error) {
    if (res.error?.toLowerCase().includes("already registered")) {
      return {
        error:
          "An account already exists for this email. Please sign in instead, or use Forgot password if you cannot access the account.",
      };
    }

    return { error: res.error || "Signup failed." };
  }

  // Branch C — confirm-email pending (Confirm email ON, valid signUp)
  if (res.emailPending) {
    return { success: true, emailPending: true, registeredEmail: email };
  }

  // Branch D — session present (Confirm email OFF)
  return {
    success: true,
    redirectUrl: "/login?registered=true",
  };
}
