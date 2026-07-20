import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/auth/helpers";
import { errorResponse, successResponse } from "@/lib/api-response";
import { logEvent } from "@/lib/logger";
import { DEPARTMENTS, SYSTEM_EVENT_TYPES } from "@/lib/constants";
import { validateName } from "@/lib/validation";
import type { Department } from "@/types";
import { z } from "zod";

export const dynamic = "force-dynamic";

function normalizeEmployeeType(value: unknown) {
  if (typeof value !== "string") return null;
  const titles = value
    .split("|")
    .map((title) => title.trim().replace(/\|/g, ""))
    .filter(Boolean)
    .slice(0, 5)
    .map((title) => title.slice(0, 80));

  return titles.length ? titles.join("|") : null;
}

function getStaffCreateErrorMessage(error: unknown): { message: string; status: number } {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;

  if (code === "email_exists") {
    return { message: "An account with this email address already exists.", status: 409 };
  }

  if (error instanceof Error && /user already registered/i.test(error.message)) {
    return { message: "An account with this email address already exists.", status: 409 };
  }

  return { message: "Failed to create staff member", status: 500 };
}

const staffEmailSchema = z.string().trim().email("Invalid email address.");


function isDepartment(value: unknown): value is Department {
  return typeof value === "string" && value in DEPARTMENTS;
}

// GET: list all staff members (non-patients) with merged email from Auth
export async function GET() {
  try {
    await requirePermission("staff.manage");
    const supabase = createClient();
    const adminClient = createAdminClient();

    // Fetch profiles and auth users in parallel
    const [profilesResult, usersResult] = await Promise.all([
      supabase
        .from("profiles")
        .select("*")
        .neq("role", "patient")
        .order("created_at", { ascending: false }),
      adminClient.auth.admin.listUsers({
        perPage: 1000
      })
    ]);

    if (profilesResult.error) throw profilesResult.error;
    if (usersResult.error) throw usersResult.error;

    // Map user id -> email
    const emailMap = new Map<string, string>();
    usersResult.data.users.forEach((u) => {
      emailMap.set(u.id, u.email || "");
    });

    const staffWithEmails = profilesResult.data.map((profile) => ({
      ...profile,
      email: emailMap.get(profile.id) || "",
    }));

    return successResponse(staffWithEmails);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse("Failed to list staff", 500, message);
  }
}

// POST: create a new staff member
export async function POST(request: Request) {
  try {
    const adminProfile = await requirePermission("staff.manage");
    const body = await request.json();
    const { email, password, fullName, roleId, department } = body;
    const employeeType = normalizeEmployeeType(body.employeeType);

    // Validate request body
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      typeof fullName !== "string" ||
      typeof roleId !== "string" ||
      !email ||
      !password ||
      !fullName ||
      !roleId
    ) {
      return errorResponse("Missing required fields: email, password, fullName, roleId", 400);
    }

    const emailValidation = staffEmailSchema.safeParse(email);
    if (!emailValidation.success) {
      return errorResponse(emailValidation.error.issues[0]?.message || "Invalid email address.", 400);
    }

    const nameCheck = validateName(fullName, "Full name");
    if (!nameCheck.valid) {
      return errorResponse(nameCheck.error ?? "Invalid full name.", 400);
    }

    const supabase = createClient();

    // Look up role details from DB
    const { data: dbRole, error: dbRoleError } = await supabase
      .from("roles")
      .select("*")
      .eq("id", roleId)
      .single();

    if (dbRoleError || !dbRole) {
      return errorResponse("Select a valid role.", 400);
    }

    if (dbRole.is_system && dbRole.name === "patient") {
      return errorResponse("The patient role cannot be assigned to staff members.", 400);
    }

    const legacyRoleText = dbRole.is_system ? dbRole.name : dbRole.base_role;

    if (legacyRoleText === "department_staff" && !isDepartment(department)) {
      return errorResponse("Clinical department is required for Department Staff.", 400);
    }

    const adminClient = createAdminClient();
    const normalizedEmail = emailValidation.data;
    const normalizedFullName = fullName.trim();
    const normalizedDepartment = legacyRoleText === "department_staff" ? department : null;

    // 1. Create auth user with metadata (trigger will auto-create profile and registration log using legacy text)
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: normalizedFullName,
        role: legacyRoleText,
        department: normalizedDepartment,
        employee_type: employeeType,
      },
    });

    if (authError || !authData.user) {
      throw authError || new Error("Auth user creation failed");
    }

    // 2. Fetch the newly created profile row. Retries if the database trigger is asynchronous
    let profile = null;
    let retries = 5;

    while (retries > 0) {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", authData.user.id)
        .single();

      if (!error && data) {
        profile = data;
        break;
      }
      retries--;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    if (!profile) {
      throw new Error("Trigger failed to create public.profiles record.");
    }

    const { data: updatedProfile, error: profileUpdateError } = await supabase
      .from("profiles")
      .update({ 
        employee_type: employeeType,
        role: legacyRoleText,
        role_id: roleId 
      })
      .eq("id", authData.user.id)
      .select()
      .single();

    if (profileUpdateError) {
      throw profileUpdateError;
    }

    profile = updatedProfile;

    // 3. Log the administrative audit event
    await logEvent(
      supabase,
      adminProfile.id,
      SYSTEM_EVENT_TYPES.STAFF_CREATED,
      `Staff user created: ${normalizedFullName} (${normalizedEmail}) as ${legacyRoleText}`,
      null,
      { target_user_id: authData.user.id, role: legacyRoleText, department: normalizedDepartment, employee_type: employeeType }
    );

    // 4. Emit the ROLE_ASSIGNED event (Condition 2)
    await logEvent(
      supabase,
      adminProfile.id,
      SYSTEM_EVENT_TYPES.ROLE_ASSIGNED,
      `Role '${dbRole.name}' assigned to staff member ${normalizedFullName}`,
      null,
      { target_user_id: authData.user.id, role_id: roleId, role_name: dbRole.name, base_role: dbRole.base_role }
    );

    return successResponse(
      { ...profile, email: authData.user.email },
      "Staff account created successfully",
      201
    );
  } catch (error: unknown) {
    const safeError = getStaffCreateErrorMessage(error);
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(safeError.message, safeError.status, message);
  }
}
