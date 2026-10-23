import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import colors from "tailwindcss/colors";
import tailwindConfig from "../../tailwind.config";

/**
 * Issue #171: muted text on the warm light background. Tailwind's slate-400,
 * slate-500 and teal-600 (and shadcn's stock --muted-foreground) are tuned for
 * white, so on the beige page and its tinted cards they fell below 4.5:1. The
 * fix lives in the theme tokens, so this test reads them straight from
 * globals.css and checks every light surface muted text sits on.
 */

type Rgb = [number, number, number];

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

/** The `--name: value;` declarations of one theme block (`:root` or `.dark`). */
function themeVars(selector: ":root" | ".dark"): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no ${selector} block in globals.css`);
  const block = css.slice(start, css.indexOf("\n  }", start));
  const vars: Record<string, string> = {};
  for (const [, name, value] of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[name] = value.trim();
  return vars;
}

const light = themeVars(":root");
const dark = themeVars(".dark");

function hsl(value: string): Rgb {
  const [h, s, l] = value.split(/\s+/).map((part) => parseFloat(part));
  const sat = s / 100;
  const lig = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  return [0, 8, 4].map((n) => Math.round(255 * (lig - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))))) as Rgb;
}

function rgbTriple(value: string): Rgb {
  return value.split(/\s+/).map(Number) as Rgb;
}

function parseHex(hex: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function over(top: Rgb, alpha: number, bottom: Rgb): Rgb {
  return top.map((v, i) => Math.round(v * alpha + bottom[i] * (1 - alpha))) as Rgb;
}

const page = hsl(light.background);
/** Every light surface muted text is drawn on: the page, the token fills, a
 * white card, the pale tints cards use, and the kanban columns' slate wash. */
const LIGHT_SURFACES: Record<string, Rgb> = {
  page,
  card: hsl(light.card),
  muted: hsl(light.muted),
  secondary: hsl(light.secondary),
  accent: hsl(light.accent),
  "slate-50": parseHex(colors.slate["50"]),
  "slate-100": parseHex(colors.slate["100"]),
  "amber-50": parseHex(colors.amber["50"]),
  "teal-50": parseHex(colors.teal["50"]),
  "slate-900/5 on page": over(parseHex(colors.slate["900"]), 0.05, page),
};

const LIGHT_TEXT: Record<string, Rgb> = {
  "--muted-foreground": hsl(light["muted-foreground"]),
  "text-slate-400": rgbTriple(light["text-slate-400"]),
  "text-slate-500": rgbTriple(light["text-slate-500"]),
  "text-teal-600": rgbTriple(light["text-teal-600"]),
};

describe("light-mode muted text contrast (issue #171)", () => {
  for (const [text, colour] of Object.entries(LIGHT_TEXT)) {
    for (const [surface, background] of Object.entries(LIGHT_SURFACES)) {
      it(`${text} on ${surface} clears 4.5:1`, () => {
        expect(contrast(colour, background)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("keeps slate-400 lighter than slate-500 so the two still read as distinct steps", () => {
    expect(luminance(LIGHT_TEXT["text-slate-400"])).toBeGreaterThan(luminance(LIGHT_TEXT["text-slate-500"]));
  });
});

describe("dark mode keeps Tailwind's own text shades (issue #171)", () => {
  it.each([
    ["text-slate-400", colors.slate["400"]],
    ["text-slate-500", colors.slate["500"]],
    ["text-teal-600", colors.teal["600"]],
  ])("%s resolves to the stock value under .dark", (name, hex) => {
    expect(rgbTriple(dark[name])).toEqual(parseHex(hex));
  });
});

describe("the text-only overrides are wired into Tailwind (issue #171)", () => {
  const textColor = tailwindConfig.theme?.extend?.textColor as Record<string, Record<string, string>>;

  it.each([
    ["slate", "400"],
    ["slate", "500"],
    ["teal", "600"],
  ])("text-%s-%s reads its theme variable", (name, shade) => {
    expect(textColor[name][shade]).toBe(`rgb(var(--text-${name}-${shade}) / <alpha-value>)`);
  });

  it("leaves the shared palette alone, so bg-/border- utilities keep Tailwind's values", () => {
    expect(tailwindConfig.theme?.extend?.colors).not.toHaveProperty("slate");
    expect(tailwindConfig.theme?.extend?.colors).not.toHaveProperty("teal");
  });
});
