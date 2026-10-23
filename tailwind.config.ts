import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

/**
 * Attribute-selector body for a `key=value` pair, e.g. `slot=card-footer` →
 * `slot="card-footer"`. Mirrors Tailwind's own `normalizeAttributeSelectors`,
 * which is not part of the public API.
 */
function attributeValue(value: string): string {
  const separator = value.indexOf("=");
  if (separator === -1) return value;
  const raw = value.slice(separator + 1);
  if (raw.startsWith('"') || raw.startsWith("'")) return value;
  return `${value.slice(0, separator)}="${raw}"`;
}

/**
 * The shadcn "base-nova" ui kit is written for **Tailwind v4**, but this repo
 * runs **Tailwind v3.4**. v4 understands a number of variant and utility
 * spellings v3 does not have at all, so every class that uses one of them
 * compiled to *nothing*:
 *
 * - #168 — bare `data-<state>:` variants (`data-open:`), `in-data-[…]:`
 *   ("inside an element carrying that data attribute") and `has-data-[…]:`
 *   ("this element contains one"). Dialog/sheet transitions never ran, the
 *   switch never changed colour, and the icon/button-group paddings never
 *   applied.
 * - #175 — `not-data-[…]:` (the negated `data-[…]` variant), `has-aria-expanded:`
 *   ("this element contains an expanded `aria-expanded` control"), and the
 *   `*:` / `**:` child/descendant variants.
 *
 * Base UI (the primitives the kit is built on) really does set these
 * attributes — `data-open` / `data-closed` on popups and backdrops,
 * `data-checked` / `data-unchecked` on the switch root *and* its thumb,
 * `data-disabled` on disabled controls, `data-placeholder` on an empty select
 * trigger, `data-starting-style` / `data-ending-style` while a popup
 * transitions, `aria-expanded` on a disclosure trigger, and
 * `data-variant="destructive"` on a destructive select item — so registering
 * the v3 equivalents centrally is enough.
 *
 * The only classes that had to change are the two select chains that use the
 * `*:` / `**:` combinator variants: v3.4 cannot express them in the order v4
 * writes them, so the chains are written the other way round (see the
 * `addVariant("**", …)` comment below and `src/components/ui/select.tsx`).
 *
 * The variant names below are also the marker the regression test uses to
 * find this plugin (see `src/lib/tailwind-data-variants.test.ts`).
 */
const baseUiDataVariants = plugin(
  ({ addVariant, matchVariant, addUtilities }) => {
    // v4 `data-open:` → `&[data-open]`
    addVariant("data-open", "&[data-open]");
    addVariant("data-closed", "&[data-closed]");
    addVariant("data-checked", "&[data-checked]");
    addVariant("data-unchecked", "&[data-unchecked]");
    addVariant("data-disabled", "&[data-disabled]");
    addVariant("data-placeholder", "&[data-placeholder]");
    addVariant("data-starting-style", "&[data-starting-style]");
    addVariant("data-ending-style", "&[data-ending-style]");

    // v4 `in-data-[slot=button-group]:` → `:where([data-slot="button-group"]) &`
    matchVariant(
      "in-data",
      (value) => `:where([data-${attributeValue(value)}]) &`,
    );

    // v4 `has-data-[slot=card-footer]:` → `&:has([data-slot="card-footer"])`
    matchVariant(
      "has-data",
      (value) => `&:has([data-${attributeValue(value)}])`,
    );

    // v4 `group-has-data-[slot=alert-dialog-media]/alert-dialog-content:` →
    // `:where(.group\/alert-dialog-content):has([data-slot="alert-dialog-media"]) &`
    matchVariant(
      "group-has-data",
      (value, { modifier }) =>
        `${
          modifier
            ? `:merge(.group\\/${modifier})`
            : ":merge(.group)"
        }:has([data-${attributeValue(value)}]) &`,
    );

    // v4 `not-data-[variant=destructive]:` → `&:not([data-variant="destructive"])`
    // v3.4 has no `not-*` variant family at all, so the ui kit's negated
    // data/aria selectors compiled to nothing.
    matchVariant(
      "not-data",
      (value) => `&:not([data-${attributeValue(value)}])`,
    );
    matchVariant(
      "not-aria",
      (value) => `&:not([aria-${attributeValue(value)}])`,
    );
    addVariant("not-first", "&:not(:first-child)");
    addVariant("not-last", "&:not(:last-child)");
    addVariant("not-only", "&:not(:only-child)");
    addVariant("not-empty", "&:not(:empty)");

    // v4 `has-aria-expanded:` → `&:has([aria-expanded="true"])`
    addVariant("has-aria-expanded", '&:has([aria-expanded="true"])');
    matchVariant(
      "has-aria",
      (value) => `&:has([aria-${attributeValue(value)}])`,
    );

    // v4 `**:` → `& *` (descendant). v3.4 only ships the child variant
    // (`*:`, `& > *`); the descendant one is v4 only.
    //
    // v4 applies variants left to right to a *moving* target, so the
    // combinator decides which element the other variants in the chain apply
    // to. v3.4 applies the chain right to left and always hangs the
    // pseudo-classes off the last node of the selector, so a class that
    // puts the combinator first (`*:data-[slot=select-value]:…`) ends up with
    // the attribute on the *parent* instead of the child. The ui kit
    // therefore has to write those chains the other way round
    // (`data-[slot=select-value]:*:…`); see `src/components/ui/select.tsx`.
    addVariant("**", "& *");

    // v4 `supports-backdrop-filter:` → `@supports (backdrop-filter: var(--tw))`.
    // v3.4 only knows the bracketed `supports-[…]:` form, so the dialog,
    // alert-dialog and sheet overlays lost their backdrop blur (issue #175).
    addVariant(
      "supports-backdrop-filter",
      "@supports (backdrop-filter: var(--tw))",
    );

    // v4 `outline-hidden` → `outline-style: none` (plus the forced-colors
    // fallback v4 ships). v3.4 only knows `outline-none`, which draws a
    // transparent 2px outline instead of removing the outline style.
    addUtilities({
      ".outline-hidden": {
        "--tw-outline-style": "none",
        "outline-style": "none",
        "@media (forced-colors: active)": {
          outline: "2px solid transparent",
          "outline-offset": "2px",
        },
      },
    });

    // v4 `field-sizing-content` → `field-sizing: content` (a textarea that
    // grows with its content). v3.4 has no such utility.
    addUtilities({
      ".field-sizing-content": {
        "field-sizing": "content",
      },
    });
  },
);

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    // src/lib holds class-string maps (constants.ts role and department badge
    // fills, for one). Without this entry Tailwind never generates those
    // classes, so a badge built from a lib constant renders with no background
    // at all (issue #153).
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      // Tailwind v3 ships ring widths 0/1/2/4/8 only; `ring-3` is a Tailwind v4
      // utility. The shadcn "base-nova" ui kit (button, input, select, textarea,
      // switch) declares `focus-visible:ring-3` / `aria-invalid:ring-3`, which
      // silently compiled to nothing here — no ring-width utility means
      // `--tw-ring-shadow` stays at its `0 0 #0000` default and box-shadow is
      // never set, so keyboard focus painted only a 1px border recolor
      // (issue #149). Adding the key makes `.ring-3` a first-class utility with
      // the same ring machinery as `.ring-2`.
      ringWidth: {
        3: "3px",
      },
      // Same story: `aria-invalid:*` is a built-in Tailwind v4 variant, but v3's
      // default theme.aria has no `invalid` entry, so every `aria-invalid:*`
      // class (invalid-state rings/borders in the ui kit) was dead too.
      aria: {
        invalid: 'invalid="true"',
      },
      // v3's underline-offset scale is 0/1/2/4/8/auto; v4 derives any
      // integer from the `--spacing` multiplier, so the ui kit's
      // `underline-offset-3` (the offset under a link in an alert title, an
      // alert description and a dialog description) is a v4-only utility
      // that compiled to nothing here — the links were underlined with no
      // offset at all (issue #178).
      textUnderlineOffset: {
        3: "3px",
      },
      // v3's spacing scale stops at 14/16/20; v4 derives any integer from the
      // `--spacing` multiplier, so `pr-18` (the ui kit's alert-action padding,
      // used together with the `has-data-[slot=alert-action]:` variant) is a
      // v4-only utility that compiled to nothing here. 18 × 0.25rem = 4.5rem.
      spacing: {
        18: "4.5rem",
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
          text: "hsl(var(--destructive-text))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        accentBlue: {
          50: "#f0f7ff",
          100: "#e0eefe",
          200: "#bae0fd",
          300: "#7cc4fc",
          400: "#38a7fa",
          500: "#0e8beb",
          600: "#1f6dd2",
          700: "#0c4fa3",
          800: "#0f4486",
          900: "#133a70",
          950: "#0d254c",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        // v4's default theme ships `--radius-4xl: 2rem`; v3.4's radius scale
        // stops at `3xl`, so the ui kit's `rounded-4xl` (the badge) compiled
        // to nothing (issue #175).
        "4xl": "2rem",
      },
      // v4 `backdrop-blur-xs` → `blur(var(--blur-xs))` with v4's default
      // `--blur-xs: 4px`. v3.4's backdrop-blur scale starts at `sm` (4px),
      // so the name `xs` did not exist and the sheet/dialog backdrops lost
      // their blur (issue #175).
      backdropBlur: {
        xs: "4px",
      },
      // v4 lets a utility take a bare CSS variable as its value:
      // `max-h-(--available-height)` → `max-height: var(--available-height)`.
      // v3.4 has no such shorthand, so the select popup's height, width and
      // transform origin — the three values Base UI publishes as CSS
      // variables on the positioner — compiled to nothing (issue #175).
      maxHeight: {
        "(--available-height)": "var(--available-height)",
      },
      width: {
        "(--anchor-width)": "var(--anchor-width)",
      },
      transformOrigin: {
        "(--transform-origin)": "var(--transform-origin)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        // The pending bar for a client navigation (issue #182). The bar is a
        // third of the window wide and slides along a faint track, so the
        // indicator is on screen from the first frame and the movement says
        // "still working" without a spinner on every link.
        "navigation-progress": {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(200%)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "navigation-progress": "navigation-progress 1s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), baseUiDataVariants],
};
export default config;
