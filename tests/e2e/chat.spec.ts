import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ usersKey, sessionKey, user }) => {
    window.localStorage.setItem(usersKey, JSON.stringify([user]));
    window.localStorage.setItem(sessionKey, user.id);
  }, {
    usersKey: "liara-mock-users-v1",
    sessionKey: "liara-mock-session-v1",
    user: {
      id: "33333333-3333-4333-8333-333333333333",
      name: "کاربر تست",
      email: "test@example.com",
      createdAt: "2026-08-21T00:00:00.000Z",
      passwordSalt: "dGVzdC1zYWx0",
      passwordDigest: "dGVzdC1kaWdlc3Q=",
    },
  });
});

test("keeps the new-chat control vertically comfortable", async ({ page }, testInfo) => {
  await page.goto("/assistant");
  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: "بازکردن تاریخچه" }).click();
  }
  const newChat = page.getByRole("button", { name: /گفتگوی جدید/ }).first();
  await expect(newChat).toBeVisible();
  const padding = await newChat.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      top: Number.parseFloat(style.paddingTop),
      bottom: Number.parseFloat(style.paddingBottom),
    };
  });
  expect(padding.top).toBeGreaterThanOrEqual(10);
  expect(padding.bottom).toBeGreaterThanOrEqual(10);
});

test("does not expose index diagnostics in the user-facing sidebar", async ({ page }, testInfo) => {
  await page.goto("/assistant");
  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: "بازکردن تاریخچه" }).click();
  }
  const sidebar = page.getByRole("complementary", { name: "تاریخچه گفتگوها" });

  await expect(sidebar).not.toContainText(/ایندکس داک|در حال بررسی ایندکس|Meilisearch|Local fallback/);
});

test("keeps the working theme control in the top workspace controls", async ({ page }, testInfo) => {
  await page.goto("/assistant");
  const topBar = testInfo.project.name === "mobile"
    ? page.locator(".mobile-header")
    : page.locator(".trust-strip");
  const themeButton = topBar.getByRole("button", { name: /فعال‌کردن تم/ });

  await expect(themeButton).toBeVisible();
  const previousTheme = await page.locator("html").getAttribute("data-theme");
  await themeButton.click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", previousTheme ?? "");
  await expect(page.getByRole("complementary", { name: "تاریخچه گفتگوها" })
    .getByRole("button", { name: /فعال‌کردن تم/ })).toHaveCount(0);
});

test("uses calm theme-aware colors for inline code inside answers", async ({ page }, testInfo) => {
  await page.addInitScript(() => window.localStorage.setItem("liara-assistant-theme", "light"));
  await page.goto("/assistant");
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("liara-assistant-user-33333333-3333-4333-8333-333333333333", 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("conversations", { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("conversations", "readwrite");
      transaction.objectStore("conversations").put({
        id: "inline-code-color-regression",
        title: "رنگ فرمان‌های پاسخ",
        createdAt: "2026-08-21T00:00:00.000Z",
        updatedAt: "2026-08-21T00:01:00.000Z",
        messages: [{
          id: "assistant-inline-code",
          role: "assistant",
          content: "ابتدا دستور `create-next-app` و سپس `liara deploy` را اجرا کنید.",
          createdAt: "2026-08-21T00:01:00.000Z",
          status: "complete",
        }],
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });
  await page.reload();

  const inlineCode = page.getByText("create-next-app", { exact: true });
  await expect(inlineCode).toBeVisible();
  const readTone = () => inlineCode.evaluate((element) => {
    const style = getComputedStyle(element);
    const channels = style.color.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
    const [red, green, blue] = channels;
    return {
      color: style.color,
      background: style.backgroundColor,
      redDominant: red > green * 1.25 && red > blue * 1.25,
    };
  });

  const light = await readTone();
  expect(light.redDominant).toBe(false);
  expect(light.background).not.toBe("rgba(0, 0, 0, 0)");

  const themeControls = testInfo.project.name === "mobile"
    ? page.locator(".mobile-header")
    : page.locator(".trust-strip");
  await themeControls.getByRole("button", { name: "فعال‌کردن تم تاریک" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const dark = await readTone();
  expect(dark.redDominant).toBe(false);
  expect(dark.color).not.toBe(light.color);
});

test("starts a new chat with the browser-safe Alt+N shortcut", async ({ page }) => {
  await page.goto("/assistant");
  const composer = page.getByLabel("پیام به دستیار لیارا");
  await composer.fill("این گفتگو برای تست میانبر ساخته شده است");
  await composer.press("Enter");
  await expect(page.locator(".conversation-row")).toHaveCount(1);
  const stopResponse = page.getByRole("button", { name: "توقف پاسخ" });
  if (await stopResponse.isVisible()) await stopResponse.click();

  await page.keyboard.press("Alt+N");

  await expect(page.getByRole("heading", { name: "چه مشکلی در لیارا داری؟" })).toBeVisible();
  await expect(page.locator(".new-chat-button kbd")).toHaveText("Alt N");
});

test("previews an escalation ticket with transport reserved for the next phase", async ({ page }) => {
  await page.goto("/assistant");
  const composer = page.getByLabel("پیام به دستیار لیارا");
  await composer.fill("لطفاً برای خطای ناشناخته استقرار من یک تیکت پشتیبانی آماده کن");
  await composer.press("Enter");

  const ticket = page.getByRole("region", { name: "پیش‌نویس تیکت پشتیبانی" });
  await expect(ticket).toBeVisible({ timeout: 20_000 });
  await expect(ticket).toContainText("پیش‌نویس تیکت آماده است");
  await expect(ticket.getByRole("button", { name: "ارسال تیکت" })).toBeDisabled();
  await expect(ticket).toContainText("فعلاً هیچ درخواستی ارسال نمی‌شود");
});

test("keeps conversation options visible on touch screens", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Touch-only behavior");
  await page.goto("/assistant");
  const composer = page.getByLabel("پیام به دستیار لیارا");
  await composer.fill("گفتگو برای تست منوی موبایل");
  await composer.press("Enter");
  await expect(page.locator(".conversation-row")).toHaveCount(1);
  await page.getByRole("button", { name: "بازکردن تاریخچه" }).click();

  await expect(page.locator(".conversation-actions")).toHaveCSS("opacity", "1");
  await expect(page.getByRole("button", { name: /^گزینه‌های گفتگوی/ })).toBeVisible();
});

test("moves naturally from a social greeting to a grounded technical answer", async ({ page }) => {
  await page.goto("/assistant");
  const composer = page.getByLabel("پیام به دستیار لیارا");

  await composer.fill("hi چطوری من خوبم");
  await composer.press("Enter");
  const greetingTurn = page.locator(".assistant-turn").first();
  await expect(greetingTurn.getByText(/سلام|خوش اومدی/)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".user-bubble").first()).toHaveText("hi چطوری من خوبم");
  await expect(greetingTurn.locator(".message-actions")).toBeVisible({ timeout: 20_000 });
  await expect(greetingTurn.getByText("منابع استفاده‌شده")).toHaveCount(0);
  await expect(greetingTurn.getByRole("region", { name: "مسیر حل مسئله" })).toHaveCount(0);
  await expect(greetingTurn.getByText("شواهد مستند قوی")).toHaveCount(0);

  await composer.fill("برای اتصال دامنه به برنامه لیارا باید چه کار کنم؟");
  await composer.press("Enter");
  const technicalTurn = page.locator(".assistant-turn").nth(1);
  await expect(technicalTurn.getByText("منابع استفاده‌شده")).toBeVisible({ timeout: 20_000 });
  await expect(technicalTurn.locator(".source-chip-row button").first()).toBeVisible();
  await expect(page.locator(".assistant-turn")).toHaveCount(2);
});

test("answers from Liara docs and keeps the conversation after refresh", async ({ page }) => {
  test.setTimeout(75_000);
  await page.goto("/assistant");
  await expect(page.getByRole("heading", { name: "چه مشکلی در لیارا داری؟" })).toBeVisible();

  const composer = page.getByLabel("پیام به دستیار لیارا");
  await composer.fill("برای اتصال دامنه به برنامه لیارا باید چه کار کنم؟");
  await composer.press("Enter");

  await expect(page.getByText("دستیار لیارا", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("منابع استفاده‌شده")).toBeVisible({ timeout: 20_000 });
  const sourcesToggle = page.locator(".sources-compact");
  const sourcesPanel = page.locator("#source-panel");
  await expect(sourcesToggle).toHaveAttribute("aria-expanded", "false");
  await sourcesToggle.click();
  await expect(sourcesToggle).toHaveAttribute("aria-expanded", "true");
  await expect(sourcesPanel).toHaveClass(/is-open/);
  await sourcesToggle.click();
  await expect(sourcesToggle).toHaveAttribute("aria-expanded", "false");
  await expect(sourcesPanel).not.toHaveClass(/is-open/);
  await sourcesToggle.click();
  await page.keyboard.press("Escape");
  await expect(sourcesToggle).toHaveAttribute("aria-expanded", "false");
  await page.locator(".source-chip-row button").first().click();
  await expect(page.getByRole("dialog", { name: /جزئیات منبع/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /مشاهده در مستندات لیارا/ }))
    .toHaveAttribute("href", /^https:\/\/docs\.liara\.ir\//);
  await page.reload();
  await expect(page.locator(".user-bubble").getByText("برای اتصال دامنه به برنامه لیارا باید چه کار کنم؟", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  const historyButton = page.getByRole("button", { name: "بازکردن تاریخچه" });
  if (await historyButton.count()) await historyButton.click();
  const conversationOptions = page.locator(".conversation-row").first().getByRole("button", { name: /^گزینه‌های گفتگوی/ });
  await expect(conversationOptions).toBeVisible();
  await conversationOptions.click();
  await page.getByRole("menuitem", { name: "تغییر نام" }).click();
  const titleInput = page.getByRole("textbox", { name: "نام گفتگو" });
  await titleInput.fill("بررسی اتصال دامنه");
  await titleInput.press("Enter");
  await expect(page.getByText("بررسی اتصال دامنه", { exact: true })).toBeVisible();
});

test("keeps long source references inside the sources panel at responsive widths", async ({ page }) => {
  await page.goto("/assistant");
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("liara-assistant-user-33333333-3333-4333-8333-333333333333", 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("conversations", { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("conversations", "readwrite");
      transaction.objectStore("conversations").put({
        id: "source-overflow-regression",
        title: "اتصال PostgreSQL در PHP",
        createdAt: "2026-08-21T00:00:00.000Z",
        updatedAt: "2026-08-21T00:01:00.000Z",
        messages: [{
          id: "user-source-overflow",
          role: "user",
          content: "اتصال PostgreSQL به PHP",
          createdAt: "2026-08-21T00:00:00.000Z",
        }, {
          id: "assistant-source-overflow",
          role: "assistant",
          content: "تنظیمات اتصال را از مستندات لیارا بررسی کنید.",
          createdAt: "2026-08-21T00:01:00.000Z",
          status: "complete",
          sources: [{
            id: "long-postgres-source",
            citationIndex: 1,
            title: "اتصال به دیتابیس PostgreSQL در برنامه‌های PHP",
            heading: "تنظیم متغیر محیطی اتصال",
            breadcrumb: ["دیتابیس", "اتصال PostgreSQL در PHP"],
            service: "dbaas",
            url: "https://docs.liara.ir/databases/postgresql/php",
            snippet: "postgres://root:2aCRtMfc2oMou67U2GftmLmd@annapurna.liara.cloud:32655/postgres?sslmode=require",
            score: 1,
          }],
        }],
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });
  await page.reload();

  const sourcesToggle = page.locator(".sources-compact");
  await expect(sourcesToggle).toBeVisible();
  await sourcesToggle.click();
  const panelContent = page.locator("#source-panel .source-panel-content");
  await expect(panelContent).toBeVisible();

  for (const viewport of [
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 1280, height: 800 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(panelContent).toBeVisible();
    const layout = await panelContent.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      overflowX: getComputedStyle(element).overflowX,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
    }));
    expect(layout.overflowX, `${viewport.width}px panel overflow`).toBe("hidden");
    expect(layout.scrollWidth, `${viewport.width}px panel width`)
      .toBeLessThanOrEqual(layout.clientWidth + 1);
    expect(layout.documentScrollWidth, `${viewport.width}px document width`)
      .toBeLessThanOrEqual(layout.documentClientWidth + 1);
  }
});

test("asks inside the app before deleting a conversation", async ({ page }) => {
  await page.goto("/assistant");
  const composer = page.getByLabel("پیام به دستیار لیارا");
  await composer.fill("برای حذف آزمایشی، روش اتصال دامنه را توضیح بده");
  await composer.press("Enter");
  await expect(page.locator(".conversation-row")).toHaveCount(1);

  const historyButton = page.getByRole("button", { name: "بازکردن تاریخچه" });
  if (await historyButton.isVisible()) await historyButton.click();

  const conversation = page.locator(".conversation-row").first();
  const conversationTitle = await conversation.locator(".conversation-title-text").innerText();
  const conversationOptions = conversation.getByRole("button", { name: /^گزینه‌های گفتگوی/ });
  const openDeleteConfirmation = async () => {
    await conversationOptions.click();
    await page.getByRole("menuitem", { name: "حذف گفتگو" }).click();
  };
  await openDeleteConfirmation();

  const confirmation = page.getByRole("alertdialog", { name: "حذف گفتگو؟" });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText(conversationTitle);
  const dialogPosition = await confirmation.evaluate((element) => ({
    top: element.getBoundingClientRect().top,
    viewportHeight: window.innerHeight,
  }));
  expect(dialogPosition.top).toBeGreaterThanOrEqual(16);
  expect(dialogPosition.top).toBeLessThan(dialogPosition.viewportHeight * 0.25);
  await expect(page.locator("[data-slot='alert-dialog-overlay']")).toHaveCSS("backdrop-filter", "none");
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await page.keyboard.press("Escape");
  await expect(confirmation).toBeHidden();
  await expect(conversationOptions).toBeFocused();

  await openDeleteConfirmation();
  await confirmation.getByRole("button", { name: "انصراف" }).click();
  await expect(confirmation).toBeHidden();
  await expect(conversation).toBeVisible();

  await openDeleteConfirmation();
  await confirmation.getByRole("button", { name: "حذف گفتگو" }).click();
  await expect(confirmation).toBeHidden();
  await expect(page.locator(".conversation-row")).toHaveCount(0);
});

test("masks a pasted secret before rendering and storing it", async ({ page }) => {
  await page.goto("/assistant");
  const composer = page.getByLabel("پیام به دستیار لیارا");
  await composer.fill("API_KEY=sk-this-value-must-never-appear-123456789 خطای استقرار دارم");
  await composer.press("Enter");
  await expect(page.getByText(/مورد حساس پیش از ارسال ماسک شد/)).toBeVisible();
  await expect(page.locator(".user-bubble").getByText(/API_KEY=\[SECRET_1\]/)).toBeVisible();
  await expect(page.getByText(/this-value-must-never-appear/)).toHaveCount(0);
});

test("moves to a newly submitted turn but does not force-follow while reading older content", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/assistant");
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

test("searches history and exports the selected conversation from its overflow menu", async ({ page }) => {
  await page.goto("/assistant");
  const composer = page.getByLabel("پیام به دستیار لیارا");
  await composer.fill("گفتگوی اول برای خروجی");
  await composer.press("Enter");
  await expect(page.locator(".conversation-row")).toHaveCount(1);

  await page.keyboard.press("Alt+N");
  await composer.fill("گفتگوی دوم فعال");
  await composer.press("Enter");
  await expect(page.locator(".conversation-row")).toHaveCount(2);

  const themeButton = page.getByRole("button", { name: /فعال‌کردن تم/ }).filter({ visible: true });
  const previousTheme = await page.locator("html").getAttribute("data-theme");
  await themeButton.click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", previousTheme ?? "");

  const historyButton = page.getByRole("button", { name: "بازکردن تاریخچه" });
  if (await historyButton.isVisible()) await historyButton.click();
  const search = page.getByRole("textbox", { name: "جستجو در گفتگوها" });
  await search.fill("اول");
  await expect(page.locator(".conversation-row")).toHaveCount(1);

  const sidebar = page.getByRole("complementary", { name: "تاریخچه گفتگوها" });
  await expect(sidebar.getByRole("button", { name: "گزارش کیفیت" })).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: "خروجی گفتگو", exact: true })).toHaveCount(0);

  await page.locator(".conversation-row").getByRole("button", { name: /^گزینه‌های گفتگوی/ }).click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "تغییر نام" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "حذف گفتگو" })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await menu.getByRole("menuitem", { name: "دریافت خروجی" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("گفتگوی-اول-برای-خروجی.md");
});
