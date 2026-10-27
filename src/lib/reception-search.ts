/**
 * Helpers for the reception-board document search.
 *
 * The search box on the reception board filters the *whole* documents table on
 * the server, not the capped page the board already loaded. Two grammars read
 * the user's term, so two different sets of characters have to be neutralised
 * before the term reaches the database:
 *
 *  - PostgREST's `like`/`ilike` operators are unusable here. After parsing,
 *    PostgREST rewrites every `*` in their value into `%` — a wildcard alias
 *    for clients that cannot URL-encode a percent — and provides no escape for
 *    it, not even inside the double-quoted values the `or=` grammar accepts.
 *    A term containing `*` would therefore match unrelated rows. The regex
 *    operators `match`/`imatch` (Postgres `~`/`~*`) have no such alias, so
 *    the search matches with `imatch` against a POSIX regular expression built
 *    from the term: every regex metacharacter (including `*`) is
 *    backslash-escaped so the term matches literally. `~*` is an unanchored
 *    substring match, so no `%`-wrapping is needed, and `%`/`_` are not regex
 *    metacharacters, so they are literal for free.
 *
 *  - PostgREST's `or=` grammar treats `,` (condition separator), `(` and `)`
 *    (grouping), `.` (field/operator separator) and `"` (value quoting) as
 *    structural. A term containing any of them would be misparsed as extra
 *    conditions or rejected outright.
 *
 * The two are escaped in-band, one layer at a time:
 *
 *  1. `escapeRegexLiteral` backslash-escapes the term's regex metacharacters
 *     so Postgres's regex engine matches them literally.
 *  2. `quotePostgrestValue` wraps the result in double quotes and escapes `"`
 *     and `\` for PostgREST's quoted-value lexer, so `,`, `(`, `)` and `.` are
 *     treated as value characters rather than grammar.
 *
 * The two backslash-escapes compose: PostgREST's quoted lexer turns each `\\`
 * back into a single `\`, which is exactly the escape the regex engine needs
 * to read `*`, `.` and friends as literals. This is verified end-to-end
 * against the live table.
 */

/** Longest search term accepted, in characters after trimming. */
export const MAX_SEARCH_TERM_LENGTH = 100;

/** Maximum documents returned; the caller fetches one extra to detect this bound. */
export const SEARCH_RESULT_LIMIT = 50;

/**
 * Escape the POSIX regular-expression metacharacters in a term so it matches
 * literally under Postgres `~*`.
 *
 * Backslash is escaped first so that a backslash already in the term is not
 * mistaken for an escape it did not intend. Only punctuation is escaped:
 * `\<letter>` sequences are regex character classes (`\d`, `\w`, ...), so
 * escaping a letter would change its meaning instead of pinning it.
 */
export function escapeRegexLiteral(term: string): string {
  return term.replace(/[\\.[\]{}()*+?^$|]/g, "\\$&");
}

/**
 * Quote a value for embedding in a PostgREST filter string.
 *
 * Inside double quotes PostgREST treats `"` and `\` as escape sequences, so
 * those are escaped; everything else — including the `,`, `(`, `)` and `.`
 * that would otherwise be structural in an `or=` filter — is taken literally.
 */
export function quotePostgrestValue(value: string): string {
  return '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

/**
 * The `imatch` pattern for "the term appears anywhere", escaped for the regex
 * engine and quoted for PostgREST. Ready to embed as
 * `column.imatch.${buildSearchPattern(term)}`.
 */
export function buildSearchPattern(term: string): string {
  return quotePostgrestValue(escapeRegexLiteral(term));
}

/**
 * PostgREST `or` conditions matching a patient's "first last" name the way the
 * board's local filter did (`"${first} ${last}".includes(term)`): one
 * condition per point where the term's words could split between first_name
 * and last_name, plus each column on its own. Single-word terms only need the
 * per-column conditions.
 */
export function patientNameConditions(term: string): string[] {
  const conditions = [
    `first_name.imatch.${buildSearchPattern(term)}`,
    `last_name.imatch.${buildSearchPattern(term)}`,
  ];
  const words = term.split(/\s+/).filter(Boolean);
  for (let i = 1; i < words.length && i <= MAX_NAME_SPLITS; i++) {
    const first = words.slice(0, i).join(" ");
    const last = words.slice(i).join(" ");
    conditions.push(`and(first_name.imatch.${buildSearchPattern(first)},last_name.imatch.${buildSearchPattern(last)})`);
  }
  return conditions;
}

/** Most first/last split points tried for a multi-word term. */
export const MAX_NAME_SPLITS = 6;

/**
 * Whether a server search for `query` re-runs the query whose results are
 * already on screen, rather than asking a new one. A refresh keeps the current
 * rows visible until the new ones arrive; a new search shows the loading state,
 * because nothing on screen answers it.
 *
 * `lastLocalQuery` is the query the loaded board answered in place (it holds the
 * whole table, so no request was made). Those results are not a server answer:
 * when the board stops being exact -- a realtime event changed the table -- the
 * same query has to go to the server, and its first request must show the
 * loading state. Treating it as a refresh would empty the board behind a
 * "Search unavailable" line for the length of a round trip.
 */
export function isSearchRefresh(query: string, lastServerQuery: string, lastLocalQuery: string): boolean {
  return query === lastServerQuery && query !== lastLocalQuery;
}

/**
 * The client-side twin of `GET /api/reception/documents/search`: does a loaded
 * document match the term under the same rules the server applies to its
 * branches? Used only when the board holds every document, so the local answer
 * is the complete one. The server stays the authority for a truncated board.
 *
 * Case-insensitive substring matching, as the server's `imatch` does. The term
 * is literal here (no regex, no wildcards), matching the server's escaping.
 */
export function documentMatchesSearch(
  doc: { file_name: string; file_type: string; patient?: { first_name: string; last_name: string } | null; uploader?: { full_name: string } | null },
  term: string,
): boolean {
  const needle = term.trim().toLowerCase();
  if (needle.length === 0) return false;

  // File-name branch: file_name or file_type anywhere in the term's text.
  if (doc.file_name.toLowerCase().includes(needle) || doc.file_type.toLowerCase().includes(needle)) {
    return true;
  }

  // Uploader branch: the uploader's full name, when the join is present.
  if (doc.uploader?.full_name.toLowerCase().includes(needle)) {
    return true;
  }

  // Patient branch: first or last name, or a first/last split of a multi-word
  // term. Documents with no patient row cannot match here.
  if (!doc.patient) return false;
  const first = doc.patient.first_name.toLowerCase();
  const last = doc.patient.last_name.toLowerCase();
  if (first.includes(needle) || last.includes(needle)) return true;

  const words = needle.split(/\s+/).filter(Boolean);
  for (let i = 1; i < words.length && i <= MAX_NAME_SPLITS; i++) {
    if (first.includes(words.slice(0, i).join(" ")) && last.includes(words.slice(i).join(" "))) {
      return true;
    }
  }
  return false;
}
