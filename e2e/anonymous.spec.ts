import { expect, test } from "@playwright/test";

test("login renders and rejects an empty form before submission", async ({ page }) => {
  const response = await page.goto("/login");
  expect(response?.status()).toBe(200);
  await expect(page.locator("#email")).toBeVisible();
  await expect(page.locator("#password")).toBeVisible();
  await page.locator('button[type="submit"]').click();
  expect(await page.locator("#email").evaluate((element: HTMLInputElement) => element.validity.valueMissing)).toBe(true);
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
});

for (const route of ["/admin/dashboard", "/patient/dashboard", "/reception/dashboard", "/department/dashboard", "/specialist/dashboard"]) {
  test(`anonymous ${route} redirects to login with its destination`, async ({ page }) => {
    await page.goto(route);
    const destination = new URL(page.url());
    expect(destination.pathname).toBe("/login");
    expect(destination.searchParams.get("redirect")).toBe(route);
  });
}
