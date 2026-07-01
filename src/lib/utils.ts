import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { formatInTimeZone } from "date-fns-tz"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getAge(dobString: string): string | number {
  try {
    const dob = new Date(dobString);
    const diff = Date.now() - dob.getTime();
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


