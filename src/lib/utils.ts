import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { formatInTimeZone } from "date-fns-tz"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Age in whole years from a date of birth, or `""` when there is no age to show.
 *
 * ## Calendar years, not millisecond years
 *
 * The previous implementation did `new Date(now - dob).getUTCFullYear() - 1970`,
 * which counts 365.2425-day years rather than calendar years. Whether the
 * truncation landed early or late depended on how many leap days had accumulated
 * between 1970 and the patient, so it was not a consistent off-by-one: sweeping
 * DOB dates 1930-2005 against reference dates 2020-2035, the old code disagreed
 * with the calendar answer about 74,000 times over-reporting and 25,000 times
 * under-reporting.
 *
 * It is wrong in the days immediately *before* a birthday, which is the one
 * window anyone checks a birthday against. A patient born 1943-04-09 read as 82
 * on 2025-04-08, the day before their 82nd birthday; their 81st had not happened
 * yet. Age in years is a calendar count, so it is computed from calendar fields:
 * the year difference, less one if the birthday has not yet occurred this year.
 *
 * UTC calendar fields are used because `date_of_birth` is a Postgres `date`, which
 * PostgREST returns as `YYYY-MM-DD` with no time and no zone. `new Date` parses
 * that to UTC midnight, so the UTC fields are the calendar date itself rather than
 * a timezone-dependent rendering of it.
 *
 * ## Why a future DOB is not an age
 *
 * The old code took `Math.abs(...)` of the difference, so a DOB after `now` -- a
 * typo'd or mis-mapped year -- rendered a confident positive number instead of
 * anything indicating a problem. A date of birth in the future has no age; the
 * honest answer is to show nothing, and the check now rejects it rather than
 * folding the sign away. Same for an unparseable string, which the old `try/catch`
 * never actually caught: `new Date("nonsense")` does not throw, it returns
 * `Invalid Date`, so the old path returned `NaN` and the page rendered "NaN yrs".
 *
 * `""` is the same sentinel the call sites already use for "no age available",
 * which is why the degraded cases need no change at the call sites.
 *
 * ## Why `now` is required
 *
 * `now` is required rather than defaulted to `Date.now()`. Reading the clock
 * inside this function is invisible at the call site, which is exactly how the
 * hydration mismatch in #19 survived a fix that covered some call sites and not
 * others: a caller in an event handler wants the current time, a caller in
 * render must not have it. Making the caller pass the reference time forces that
 * decision to be made out loud, and gives the function a single implementation
 * to reason about. It also makes the function a pure function of its inputs,
 * which is what lets it be unit-tested with no clock and no DOM.
 */
export function getAge(
  dobString: string | null | undefined,
  now: number
): number | "" {
  if (!dobString) return "";
  const dob = new Date(dobString);
  if (Number.isNaN(dob.getTime())) return "";
  if (dob.getTime() > now) return "";

  const ref = new Date(now);
  let age = ref.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    ref.getUTCMonth() < dob.getUTCMonth() ||
    (ref.getUTCMonth() === dob.getUTCMonth() && ref.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;

  return age;
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


