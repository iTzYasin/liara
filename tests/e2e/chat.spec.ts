import { expect, test } from "@playwright/test";

test("answers from Liara docs and keeps the conversation after refresh", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "چه مشکلی در لیارا داری؟" })).toBeVisible();

  const composer = page.getByLabel("پیام به دستیار لیارا");
  await composer.fill("برای اتصال دامنه به برنامه لیارا باید چه کار کنم؟");
  await composer.press("Enter");

  await expect(page.getByText("دستیار لیارا", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("منابع استفاده‌شده")).toBeVisible({ timeout: 20_000 });
  await page.locator(".source-chip-row button").first().click();
  await expect(page.getByRole("complementary", { name: "منابع پاسخ" })).toBeVisible();
  await expect(page.getByRole("link", { name: "بازکردن همین بخش در داک لیارا" }))
    .toHaveAttribute("href", /^https:\/\/docs\.liara\.ir\//);
  await page.reload();
  await expect(page.getByText("برای اتصال دامنه به برنامه لیارا باید چه کار کنم؟")).toBeVisible();
  const historyButton = page.getByRole("button", { name: "بازکردن تاریخچه" });
  if (await historyButton.isVisible()) await historyButton.click();
  await page.locator("button[aria-label^='تغییر نام']").first().click();
  const titleInput = page.getByRole("textbox", { name: "نام گفتگو" });
  await titleInput.fill("بررسی اتصال دامنه");
  await titleInput.press("Enter");
  await expect(page.getByText("بررسی اتصال دامنه", { exact: true })).toBeVisible();
});

test("masks a pasted secret before rendering and storing it", async ({ page }) => {
  await page.goto("/");
  const composer = page.getByLabel("پیام به دستیار لیارا");
  await composer.fill("API_KEY=sk-this-value-must-never-appear-123456789 خطای استقرار دارم");
  await composer.press("Enter");
  await expect(page.getByText(/مورد حساس پیش از ارسال ماسک شد/)).toBeVisible();
  await expect(page.getByLabel("گفتگو با دستیار لیارا").getByText(/API_KEY=\[SECRET_1\]/)).toBeVisible();
  await expect(page.getByText(/this-value-must-never-appear/)).toHaveCount(0);
});

test("moves to a newly submitted turn but does not force-follow while reading older content", async ({ page }) => {
  await page.goto("/");
  const composer = page.getByLabel("پیام به دستیار لیارا");
  for (let index = 1; index <= 3; index += 1) {
    await composer.fill(`مرحله ${index}: روش اتصال دامنه به برنامه چیست؟`);
    await composer.press("Enter");
    await expect(page.locator(".assistant-turn").nth(index - 1).locator(".message-actions")).toBeVisible({ timeout: 20_000 });
  }

  const viewport = page.locator(".message-viewport");
  await viewport.evaluate((element) => element.scrollTo({ top: 0 }));
  await expect(page.getByRole("button", { name: "رفتن به جدیدترین پیام" })).toBeVisible();

  await composer.fill("مرحله بعدی: رکورد DNS را چطور بررسی کنم؟");
  await composer.press("Enter");
  await expect(page.locator(".assistant-turn")).toHaveCount(4);
  await expect(page.locator(".assistant-turn").nth(3).locator(".message-actions")).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => viewport.evaluate((element) =>
    element.scrollHeight - element.scrollTop - element.clientHeight,
  )).toBeLessThan(170);
});

test("searches and exports local history and opens the quality ledger", async ({ page }) => {
  await page.goto("/");
  const composer = page.getByLabel("پیام به دستیار لیارا");
  await composer.fill("روش عمومی اتصال دامنه به برنامه چیست؟");
  await composer.press("Enter");
  await expect(page.locator(".assistant-turn").locator(".message-actions")).toBeVisible({ timeout: 20_000 });

  const dislike = page.getByTitle("پاسخ مفید نبود").last();
  await dislike.click();
  await expect(page.getByRole("group", { name: "دلیل مفید نبودن پاسخ" })).toBeVisible();
  await page.getByRole("button", { name: "پاسخ ناقص بود" }).click();

  const historyButton = page.getByRole("button", { name: "بازکردن تاریخچه" });
  if (await historyButton.isVisible()) await historyButton.click();
  const search = page.getByRole("textbox", { name: "جستجو در گفتگوها" });
  await search.fill("اتصال دامنه");
  await expect(page.locator(".conversation-row")).toHaveCount(1);

  const themeButton = page.locator("button[aria-label*='تم']");
  const previousTheme = await page.locator("html").getAttribute("data-theme");
  await themeButton.click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", previousTheme ?? "");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "خروجی گفتگو" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.md$/);

  await page.getByRole("button", { name: "گزارش کیفیت" }).click();
  const quality = page.getByRole("dialog", { name: "گزارش کیفیت محصول" });
  await expect(quality).toBeVisible();
  await expect(quality.getByText("صورت‌وضعیت اجرا")).toBeVisible();
  await expect(quality.getByText(/Turn موفق/)).toBeVisible();
});
