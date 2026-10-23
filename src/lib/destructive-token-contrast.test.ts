import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Issue #196: the destructive token pair. `--destructive` is the fill that
 * carries `--destructive-foreground` text; `--destructive-text` is the red for
 * text and icons on the page, the card and the destructive variants' own
 * translucent tints. The values are read from globals.css so a later edit to
 * either theme is measured, not trusted.
 */

type Rgb = [number, number, number];

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const globals = fs.readFileSync(`${repoRoot}/src/app/globals.css`, "utf8");

function themeBlock(selector: ":root" | ".dark"): string {
  const start = globals.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`globals.css has no ${selector} block`);
  return globals.slice(start, globals.indexOf("}", start));
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

function token(theme: ":root" | ".dark", name: string): Rgb {
  const match = themeBlock(theme).match(
    new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%;`),
  );
  if (!match) throw new Error(`${theme} does not define --${name}`);
  return hslToRgb(Number(match[1]), Number(match[2]), Number(match[3]));
}

function luminance([r, g, b]: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function composite(fill: Rgb, alpha: number, under: Rgb): Rgb {
  return fill.map((v, i) => Math.round(v * alpha + under[i] * (1 - alpha))) as Rgb;
}

const THEMES = [
  // The button/badge variants use /10 resting and /20 hover in light mode.
  { theme: ":root", tints: [0.1, 0.2] },
  // ...and /20 resting and /30 hover in dark mode.
  { theme: ".dark", tints: [0.2, 0.3] },
] as const;

describe("the destructive tokens (issue #196)", () => {
  for (const { theme, tints } of THEMES) {
    const fill = token(theme, "destructive");
    const surfaces = [token(theme, "background"), token(theme, "card")];

    it(`${theme}: destructive-foreground on the fill and its /90 hover is 4.5:1 or better`, () => {
      const foreground = token(theme, "destructive-foreground");
      for (const surface of surfaces) {
        for (const alpha of [1, 0.9]) {
          expect(contrast(foreground, composite(fill, alpha, surface))).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it(`${theme}: destructive-text is 4.5:1 or better on surfaces and destructive tints`, () => {
      const text = token(theme, "destructive-text");
      for (const surface of surfaces) {
        expect(contrast(text, surface)).toBeGreaterThanOrEqual(4.5);
        for (const alpha of tints) {
          expect(contrast(text, composite(fill, alpha, surface))).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }

  it("keeps the destructive variants and /admin/roles on the tokens", () => {
    for (const file of ["src/components/ui/button.tsx", "src/components/ui/badge.tsx"]) {
      const source = fs.readFileSync(`${repoRoot}/${file}`, "utf8");
      expect(source).toContain("text-destructive-text");
      expect(source).not.toMatch(/(^|[\s:"])text-destructive(?=[\s/"])/);
    }
    const roles = fs.readFileSync(
      `${repoRoot}/src/app/(dashboard)/admin/roles/RolesClient.tsx`,
      "utf8",
    );
    expect(roles).not.toMatch(/\bred-\d{2,3}\b/);
  });
});
