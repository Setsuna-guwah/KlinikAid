"use server";

import { createClient } from "@/lib/supabase/server";
import { createPatient } from "@/lib/patient/createPatient";
import { z } from "zod";

const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date of birth format"),
  gender: z.enum(["male", "female", "other"], { message: "Select a valid gender" }),
  contactNumber: z.string().min(1, "Contact number is required"),
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
