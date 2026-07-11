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
