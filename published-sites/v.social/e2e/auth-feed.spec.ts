import { expect, test } from "@playwright/test";

test("landing and login page render", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Un social network reale")).toBeVisible();
  await page.getByRole("link", { name: "Accedi" }).click();
  await expect(page.getByText("Accedi a V")).toBeVisible();
});
