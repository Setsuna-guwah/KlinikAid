import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Issue #211: at a 1280px viewport the Personnel Registry table measured
 * 1080px inside a 974px card content box, so the Status badge was cut in half
 * and the Actions column sat behind an invisible sideways scroll.
 *
 * The email column was the lever: it is the one cell whose content is
 * unbounded free text, and it alone added ~130px. Names and roles are short
 * by construction (the role and department columns come from fixed
 * catalogues), so the rule this file states is:
 *
 *   the registry's email cell clamps its text to a bounded width and carries
 *   the full address on a title attribute
 *
 * The bound matters as much as the clamp: `truncate` without a `max-w-…`
 * only ellipsises once the column has been squeezed by something else, which
 * is exactly the situation that cannot happen while the table sets its own
 * width. The ceiling below is what keeps the measured 1280px fit (table
 * min-content 917.5px against a 974px card) with room to spare.
 *
 * This is a source check because the unit tests run in node without a DOM;
 * the numbers themselves were measured with Playwright for the pull request
 * and are recorded in private/batch8/211/.
 */

const PAGE_PATH = join(__dirname, "page.tsx");

const source = readFileSync(PAGE_PATH, "utf8");

/** The email cell: the one `TableCell` in this file typed as monospace text. */
const emailCell = source.match(
  /<TableCell[^>]*font-mono[\s\S]*?<\/TableCell>/,
)?.[0];

/**
 * Widest email cell the issue's arithmetic allows. The column adds its
 * padding (16px at the kit's `p-2`, 12px with the registry's tighter
 * `[&_td]:px-1.5`) on top, so 200px still leaves the table's measured
 * min-content well inside the 974px card.
 */
const MAX_EMAIL_CELL_PX = 200;

describe("personnel registry email cell (#211)", () => {
  it("exists", () => {
    expect(emailCell, "the registry's monospace email TableCell").toBeTruthy();
  });

  it("clamps the address to a bounded width", () => {
    const bound = emailCell?.match(/max-w-\[(\d+)px\]/);
    expect(bound, "max-w-[…px] on the email text").toBeTruthy();
    expect(bound?.[1] && Number(bound[1])).toBeLessThanOrEqual(
      MAX_EMAIL_CELL_PX,
    );
    expect(emailCell, "truncate for the ellipsis").toMatch(/\btruncate\b/);
  });

  it("keeps the full address reachable on the title attribute", () => {
    expect(emailCell).toMatch(/title=\{staff\.email\}/);
  });
});
