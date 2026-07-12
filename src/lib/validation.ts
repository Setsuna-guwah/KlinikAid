export const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;

export const PASSWORD_REQUIREMENT_TEXT =
  "Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character.";

export function validatePassword(password: string): boolean {
  return PASSWORD_REGEX.test(password);
}

function getTodayInPh(): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const getPart = (type: string) => Number(parts.find((part) => part.type === type)?.value);

  return {
    year: getPart("year"),
    month: getPart("month"),
    day: getPart("day"),
  };
}

export function validateAge(dobString: string): { valid: boolean; error?: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dobString);
  if (!match) {
    return { valid: false, error: "Invalid date of birth format." };
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dob = new Date(Date.UTC(year, month - 1, day));

  if (
    dob.getUTCFullYear() !== year ||
    dob.getUTCMonth() !== month - 1 ||
    dob.getUTCDate() !== day
  ) {
    return { valid: false, error: "Invalid date of birth." };
  }

  const today = getTodayInPh();
  const isFuture =
    year > today.year ||
    (year === today.year && month > today.month) ||
    (year === today.year && month === today.month && day > today.day);

  if (isFuture) {
    return { valid: false, error: "Date of birth cannot be in the future." };
  }

  let age = today.year - year;
  const hasBirthdayPassed =
    today.month > month || (today.month === month && today.day >= day);

  if (!hasBirthdayPassed) {
    age -= 1;
  }

  if (age < 18) {
    return {
      valid: false,
      error: "Registration is restricted to individuals 18 years old and above.",
    };
  }

  return { valid: true };
}

// Shared name rule — applied to firstName, lastName, and fullName on every form surface.
// Min 3 / Max 100 / Letters (including accented characters) + spaces + hyphens + apostrophes + periods.
export const NAME_REGEX = /^[A-Za-zÀ-ÿ\s\-'\.]+$/;
export const NAME_MIN = 3;
export const NAME_MAX = 100;

export function validateName(
  name: string,
  label = "Name"
): { valid: boolean; error?: string } {
  const trimmed = name.trim();
  if (trimmed.length < NAME_MIN) {
    return {
      valid: false,
      error: `${label} must be at least ${NAME_MIN} characters.`,
    };
  }
  if (trimmed.length > NAME_MAX) {
    return {
      valid: false,
      error: `${label} must be no more than ${NAME_MAX} characters.`,
    };
  }
  if (!NAME_REGEX.test(trimmed)) {
    return {
      valid: false,
      error: `${label} may only contain letters, spaces, hyphens, apostrophes, or periods.`,
    };
  }
  return { valid: true };
}

// Shared contact rule — Philippine mobile only: 09XXXXXXXXX (11 digits).
export const CONTACT_REGEX = /^09\d{9}$/;
export const CONTACT_REQUIREMENT_TEXT =
  "Contact number must be a valid Philippine mobile number (e.g. 09171234567).";

export function validateContactNumber(
  contact: string
): { valid: boolean; error?: string } {
  if (!CONTACT_REGEX.test(contact.trim())) {
    return { valid: false, error: CONTACT_REQUIREMENT_TEXT };
  }
  return { valid: true };
}
