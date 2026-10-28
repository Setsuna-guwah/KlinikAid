/**
 * Client-side twin of the specialist directory's text search
 * (`GET /api/specialist/patients?query=`).
 *
 * The directory holds the complete roster only when the page loaded every
 * patient (see SpecialistPatientsClient), and then a plain-text query can be
 * answered from that list with no request. Anything the local rules do not
 * reproduce exactly stays on the server.
 */

/**
 * A query the local match reproduces exactly: letters and digits, separated by
 * spaces, apostrophes or hyphens. Those are literal in the server's `ilike`
 * pattern. `%`, `_`, commas and parentheses are either wildcards or grammar in
 * the server's PostgREST filter, so a query that contains them goes to the
 * server. A `PT-` code is matched by id on the server, so it does too.
 */
const LOCAL_QUERY = /^[\p{L}\p{N}][\p{L}\p{N} '-]*$/u;

export function isLocallySearchable(query: string): boolean {
  const term = query.trim();
  if (term.length === 0) return true;
  if (term.toLowerCase().startsWith("pt-")) return false;
  return LOCAL_QUERY.test(term);
}

/**
 * Case-insensitive substring match on first or last name, as the server's
 * `first_name.ilike.%q% OR last_name.ilike.%q%` does. An empty query matches
 * every patient, as the server's unfiltered list does.
 */
export function rosterMatchesText(patient: { first_name: string; last_name: string }, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return (
    patient.first_name.toLowerCase().includes(needle) ||
    patient.last_name.toLowerCase().includes(needle)
  );
}
