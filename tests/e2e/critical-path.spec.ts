import { expect, test, type Page } from "@playwright/test";
import { chooseCookies, signUp, skipTutorial, ticket } from "./helpers";

const shots = process.env.E2E_SCREENSHOTS;
const shot = async (page: Page, name: string, fullPage = false) => {
  if (shots) await page.screenshot({ path: `${shots}/${test.info().project.name}-${name}.png`, fullPage });
};

/** Checklist §52/§73 critical path: sign up → W$10,000 → market → review & buy → portfolio → sell. */
test("new user can trade and exit a position", async ({ page }) => {
  const username = `e2e_${Date.now().toString(36)}`;

  // First visit: the markets feed with the how-it-works popup (§3).
  await page.goto("/");
  await chooseCookies(page);
  await expect(page.getByRole("dialog", { name: "How Wesify works" })).toBeVisible();
  await page.getByRole("button", { name: "Skip" }).click();

  await signUp(page, username);
  await expect(page.getByRole("link", { name: /Balance W\$10,000/ }).filter({ visible: true })).toBeVisible();
  await expect(page.locator("article").first()).toBeVisible();
  await shot(page, "1-feed");

  // Open a market.
  await page.locator("article").first().getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1, name: /after 24 hours/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Market rules" })).toContainText("confirmed by a reviewer");
  await skipTutorial(page);
  await shot(page, "2-market", true);

  // Buy a range: enter → review → confirm → receipt.
  await page.getByRole("region", { name: "Outcomes" }).getByRole("button", { name: /^Buy / }).first().click();
  const buy = ticket(page);
  await buy.getByRole("textbox", { name: "Amount in W$" }).fill("100");
  await expect(buy.getByText(/^If .* wins$/)).toBeVisible();
  await buy.getByRole("button", { name: "Review buy" }).click();
  await expect(buy.getByText("Review your order")).toBeVisible();
  await shot(page, "3-review");
  await buy.getByRole("button", { name: "Confirm buy" }).click();
  await expect(buy.getByText(/Bought .* shares of/)).toBeVisible();
  await expect(buy.getByText("Receipt")).toBeVisible();
  await expect(page.getByRole("link", { name: /Balance W\$9,900/ }).filter({ visible: true })).toBeVisible();
  if (test.info().project.name !== "desktop") await buy.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("region", { name: "Your positions" })).toBeVisible();

  // See it in the portfolio and the wallet.
  await page.goto("/portfolio");
  await expect(page.getByText("Portfolio value")).toBeVisible();
  await expect(page.getByRole("tab", { name: /Positions · 1/ })).toBeVisible();
  await shot(page, "4-portfolio", true);
  await page.goto("/wallet");
  await expect(page.getByText(/Matches your transaction history/)).toBeVisible();
  await expect(page.getByText(/^Bought /).first()).toBeVisible();

  // Sell before settlement.
  await page.goto("/portfolio");
  await page.getByRole("link", { name: "Sell" }).first().click();
  await skipTutorial(page);
  await page.getByRole("region", { name: "Your positions" }).getByRole("button", { name: "Sell" }).first().click();
  const sell = ticket(page);
  await expect(sell.getByText("You receive")).toBeVisible();
  await sell.getByRole("button", { name: "Review sell" }).click();
  await sell.getByRole("button", { name: "Confirm sell" }).click();
  await expect(sell.getByText(/Sold for W\$/)).toBeVisible();
  if (test.info().project.name !== "desktop") await sell.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("region", { name: "Your positions" })).toHaveCount(0);

  // Trade history shows both trades.
  await page.goto("/portfolio");
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByRole("link", { name: /^Bought / })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Sold / })).toBeVisible();
});

test("log out and back in with email and password", async ({ page }) => {
  test.skip(test.info().project.name === "mobile", "Auth flow runs once");
  const username = `login_${Date.now().toString(36)}`;
  await signUp(page, username);
  await page.goto("/profile");
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
  await page.goto("/login");
  await page.getByLabel("Email or username").fill(`${username}@example.com`);
  await page.getByLabel("Password").fill("wrong password!!");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("That email and password don't match.")).toBeVisible();
  await page.getByLabel("Password").fill("e2e password 123");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("link", { name: /Balance W\$10,000/ }).filter({ visible: true })).toBeVisible();
});

test("legal and help pages are live", async ({ page }) => {
  test.skip(test.info().project.name === "mobile", "Static pages checked once");
  for (const [path, heading] of [
    ["/terms", "Terms of Use"],
    ["/privacy", "Privacy Policy"],
    ["/rules", "How markets work"],
    ["/faq", "Frequently asked questions"],
    ["/community", "Community rules"],
    ["/support", "Help & support"],
    ["/security", "Security"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  }
  await expect(page.getByText(/no monetary value/).first()).toBeVisible();
  const robots = await page.request.get("/robots.txt");
  expect(await robots.text()).toContain("Disallow: /admin");
  const health = await page.request.get("/api/health");
  expect((await health.json()).status).toMatch(/ok|degraded/);
});

test("demo mode compresses a market and settles it", async ({ page }) => {
  test.skip(test.info().project.name === "desktop", "Timing test runs once");
  test.setTimeout(240_000);
  await page.goto("/?demo=true");
  await chooseCookies(page);
  await expect(page.getByText("Demo · 24 hours in 3 minutes")).toBeVisible();
  await expect(page.getByRole("region", { name: "Featured market" })).toBeVisible();
  await expect(page.locator("section[aria-label='Trending'] article")).toHaveCount(4);
  await shot(page, "5-demo-feed");
  await page.locator("article").first().getByRole("link").first().click();
  await page.getByRole("region", { name: "Outcomes" }).getByRole("button", { name: /^Buy / }).nth(2).click();
  const dialog = ticket(page);
  await dialog.getByRole("textbox", { name: "Amount in W$" }).fill("200");
  await dialog.getByRole("button", { name: "Review buy" }).click();
  await dialog.getByRole("button", { name: "Confirm buy" }).click();
  await expect(dialog.getByText(/Bought .* shares of/)).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
  // Wait for the compressed 24h to elapse.
  await expect(page.getByText(/Final likes:/)).toBeVisible({ timeout: 200_000 });
  await expect(page.getByRole("region", { name: "Results" })).toBeVisible();
  await shot(page, "6-demo-settled", true);
});
