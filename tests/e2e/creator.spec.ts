import { expect, test } from "@playwright/test";
import { signUp, skipTutorial } from "./helpers";

const shots = process.env.E2E_SCREENSHOTS;

/** Creator studio: connect (simulated) → upload qualifies → open one market → limit + self-trade rules. */
test("creator connects TikTok, opens a market from an eligible upload, and is limited to one per day", async ({ page }) => {
  test.skip(test.info().project.name === "mobile", "Flow is identical on mobile; runs once on desktop");

  await signUp(page, `maker_${Date.now().toString(36)}`);

  // Invite-only: apply, get approved by an admin, sign the agreement.
  await page.goto("/creator");
  await expect(page.getByRole("heading", { name: "Creator program" })).toBeVisible();
  await page.getByLabel("Where you post").fill("TikTok");
  await page.getByLabel("Your handle").fill("skate_sam");
  await page.getByLabel("Link to your profile").fill("https://www.tiktok.com/@skate_sam");
  await page.getByLabel("Followers", { exact: true }).fill("50000");
  await page.getByLabel("What you post, and how often").fill("Skate clips most days, usually a few thousand likes each.");
  await page.getByRole("button", { name: "Send application" }).click();
  await expect(page.getByText("Application under review")).toBeVisible();

  const applications = await page.request.get("/api/admin/creators", { headers: { "x-admin-token": "dev-admin" } });
  const pending = (await applications.json()).data.applications.find((a: { status: string }) => a.status === "pending");
  await page.request.post(`/api/admin/creators/${pending.id}`, { headers: { "x-admin-token": "dev-admin" }, data: { action: "approve" } });

  await page.reload();
  await expect(page.getByText("sign the creator agreement")).toBeVisible();
  await page.getByLabel("Full name").fill("Sam Skater");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Sign and continue" }).click();

  await expect(page.getByRole("heading", { name: "Creator studio" })).toBeVisible();
  await expect(page.getByText("1 available")).toBeVisible();

  // Connect goes through the OAuth routes and lands back here.
  await page.getByRole("link", { name: "Connect TikTok" }).click();
  await expect(page).toHaveURL(/\/creator$/);
  await expect(page.getByText("TikTok connected.")).toBeVisible();
  const account = page.getByRole("region", { name: "Connected accounts" });
  await expect(account.getByText("TikTok · Simulated")).toBeVisible();

  await account.getByRole("button", { name: "Simulate a new upload" }).click();
  // The simulated account may also have a scheduled upload that already qualifies, so there can be more than one.
  const ready = page.getByRole("region", { name: "Ready to open" });
  await expect(ready.getByRole("button", { name: "Open market" }).first()).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/creator-ready.png`, fullPage: true });

  // The creator was alerted.
  await expect(page.getByRole("link", { name: /Notifications, \d+ unread/ })).toBeVisible();

  await ready.getByRole("button", { name: "Open market" }).first().click();
  await expect(page).toHaveURL(/\/markets\/mkt_/);
  await expect(page.getByRole("heading", { level: 1, name: /after 24 hours/ })).toBeVisible();
  await skipTutorial(page);

  // Creators can't bet on their own market: no buy buttons, and the ticket explains why.
  await expect(page.getByRole("button", { name: /^Buy / })).toHaveCount(0);
  const ticket = page.getByRole("complementary", { name: "Order ticket" });
  await expect(ticket.getByText(/This is your market/)).toBeVisible();
  await expect(ticket.getByRole("textbox", { name: "Amount in W$" })).toHaveCount(0);

  // One per 24h: a second qualifying upload can't be opened.
  await page.goto("/creator");
  await expect(page.getByText(/^Next in \d+h/)).toBeVisible();
  await page.getByRole("region", { name: "Connected accounts" }).getByRole("button", { name: "Simulate a new upload" }).click();
  const stillReady = page.getByRole("region", { name: "Ready to open" }).getByRole("button", { name: "Open market" });
  await expect(stillReady.first()).toBeDisabled();
  for (const button of await stillReady.all()) await expect(button).toBeDisabled();
  await expect(page.getByRole("region", { name: "Earlier" }).getByRole("link", { name: "View market" })).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/creator-limited.png`, fullPage: true });
});
