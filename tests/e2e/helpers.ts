import { expect, test, type Locator, type Page } from "@playwright/test";

/** Onboarding screens → email sign-up. Lands on the markets page with W$10,000. */
export async function signUp(page: Page, username: string) {
  await page.goto("/welcome");
  await chooseCookies(page);
  await expect(page.getByRole("heading", { name: /Trade the future of virality/ })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: /Price is the crowd/ })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: /One range wins/ })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Email").fill(`${username}@example.com`);
  await page.getByLabel("Password").fill("e2e password 123");
  await page.getByLabel("Username").fill(username);
  await page.getByRole("checkbox", { name: /18 or older/ }).check();
  await page.getByRole("checkbox", { name: /I agree to the/ }).check();
  // The form rejects submissions faster than a person could type.
  await page.waitForTimeout(1600);
  await page.getByRole("button", { name: /Create account/ }).click();
  await expect(page).toHaveURL(/\/(\?tutorial=1)?$/);
}

export async function chooseCookies(page: Page) {
  const necessary = page.getByRole("button", { name: "Necessary only" });
  if (await necessary.isVisible().catch(() => false)) await necessary.click();
}

/** The first-trade walkthrough overlays the page for new users; skip it when it's there. */
export async function skipTutorial(page: Page) {
  const skip = page.getByRole("button", { name: "Skip tutorial" });
  if (await skip.isVisible({ timeout: 1500 }).catch(() => false)) await skip.click();
}

/** On mobile the order ticket is the bottom sheet; on desktop it's the panel beside the chart. */
export function ticket(page: Page): Locator {
  return test.info().project.name === "desktop" ? page.getByRole("complementary", { name: "Order ticket" }) : page.getByRole("dialog").filter({ has: page.locator("#ticket-title") });
}
