import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { formatInTimeZone } from "date-fns-tz"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Age in whole years from a date of birth.
 *
 * `now` is required rather than defaulted to `Date.now()`. Reading the clock
 * inside this function is invisible at the call site, which is exactly how the
 * hydration mismatch in #19 survived a fix that covered some call sites and not
 * others: a caller in an event handler wants the current time, a caller in
 * render must not have it. Making the caller pass the reference time forces that
 * decision to be made out loud, and gives the function a single implementation
 * to reason about.
 */
export function getAge(dobString: string, now: number): string | number {
  try {
    const dob = new Date(dobString);
    const diff = now - dob.getTime();
    const ageDate = new Date(diff);
    return Math.abs(ageDate.getUTCFullYear() - 1970);
  } catch {
    return "";
  }
}

export function formatPhTime(utcString: string | null): string {
  if (!utcString) return "--";
  try {
    return formatInTimeZone(new Date(utcString), "Asia/Manila", "MMM dd, yyyy");
  } catch {
    return utcString;
  }
}

export function formatPhTimeFull(utcString: string | null): string {
  if (!utcString) return "--";
  try {
    return formatInTimeZone(new Date(utcString), "Asia/Manila", "MMM dd, yyyy hh:mm a");
  } catch {
    return utcString;
  }
}

/**
 * Returns ISO timestamp for 00:00 PHT today in UTC (e.g. previous day 16:00Z).
 */
export function getPhtStartOfToday(): string {
  const now = new Date();
  const phTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  phTime.setUTCHours(0, 0, 0, 0);
  return new Date(phTime.getTime() - 8 * 60 * 60 * 1000).toISOString();
}


