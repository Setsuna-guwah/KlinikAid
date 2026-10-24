/**
 * Signed-out pages: what every visitor sees before logging in.
 */
export default {
  name: "anonymous",
  role: "anonymous",
  async run({ page, measure, baseURL }) {
    await page.context().clearCookies();

    await measure("hard load /login", {
      kind: "hard-load",
      action: () => page.goto(new URL("/login", baseURL).href, { waitUntil: "commit" }),
      ready: () => page.locator("#email").waitFor({ state: "visible" }),
    });

    await measure("submit empty login form -> validation shown", {
      kind: "interaction",
      action: () => page.click('button[type="submit"]'),
      ready: () => page.locator("[role='alert'], [aria-invalid='true'], #email:invalid").first().waitFor({ state: "attached" }),
    });

    await measure("hard load /register", {
      kind: "hard-load",
      action: () => page.goto(new URL("/register", baseURL).href, { waitUntil: "commit" }),
      ready: () => page.locator("form input").first().waitFor({ state: "visible" }),
    });

    await measure("anonymous /admin/dashboard -> redirected to login", {
      kind: "hard-load",
      action: () => page.goto(new URL("/admin/dashboard", baseURL).href, { waitUntil: "commit" }),
      ready: async () => {
        await page.waitForURL(/\/login/);
        await page.locator("#email").waitFor({ state: "visible" });
      },
    });
  },
};
