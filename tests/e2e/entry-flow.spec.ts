import { expect, test } from "@playwright/test";

test("uses the docs experience as the local homepage", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "به مستندات لیارا خوش آمدید" })).toBeVisible();
  await page.getByRole("link", { name: "شروع گفتگو با دستیار لیارا" }).click();
  await expect(page).toHaveURL(/\/assistant\?source=docs$/);
});

test("keeps the docs surface behind the full viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1447, height: 911 });
  await page.goto("/");

  const surfaces = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>(".docs-demo-shell");
    if (!shell) return null;
    return {
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      shellBackground: getComputedStyle(shell).backgroundColor,
      shellBottom: shell.getBoundingClientRect().bottom,
      viewportBottom: window.innerHeight,
    };
  });

  expect(surfaces).not.toBeNull();
  expect(surfaces?.bodyBackground).toBe(surfaces?.shellBackground);
  expect(surfaces?.shellBottom).toBeGreaterThanOrEqual(surfaces?.viewportBottom ?? 0);
});

test("gives the docs assistant CTA a restrained theme-aware signal", async ({ page }, testInfo) => {
  await page.goto("/docs");
  const cta = page.locator(".docs-demo-ask-button");
  const heroCta = page.getByRole("link", { name: "شروع گفتگو با دستیار لیارا" });

  const light = await cta.evaluate((element) => ({
    background: getComputedStyle(element).backgroundImage,
    shadow: getComputedStyle(element).boxShadow,
    signalAnimation: getComputedStyle(element).animationName,
  }));
  expect(light.background).not.toBe("none");
  expect(light.shadow).not.toBe("none");
  expect(light.signalAnimation).not.toBe("none");
  await expect(heroCta).toHaveCSS("animation-name", "none");
  expect(await heroCta.evaluate((element) => getComputedStyle(element, "::after").animationName))
    .toBe("none");

  if (testInfo.project.name !== "mobile") {
    await page.getByRole("button", { name: "فعال‌کردن حالت تاریک" }).click();
    await expect(page.locator(".docs-demo-shell")).toHaveClass(/is-dark/);
    const dark = await cta.evaluate((element) => ({
      background: getComputedStyle(element).backgroundImage,
      signalAnimation: getComputedStyle(element).animationName,
    }));
    expect(dark.background).not.toBe(light.background);
    expect(dark.signalAnimation).not.toBe("none");
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedMotion = await cta.evaluate((element) => ({
    duration: Number.parseFloat(getComputedStyle(element).animationDuration),
    iterations: getComputedStyle(element).animationIterationCount,
  }));
  expect(reducedMotion.duration).toBeLessThanOrEqual(0.01);
  expect(reducedMotion.iterations).toBe("1");
});

test("opens the assistant directly from the panel without an auth wall", async ({ page }) => {
  await page.goto("/assistant?source=panel");

  await expect(
    page.getByRole("heading", { name: "برای شروع روی لیارا چه کمکی می‌خواهی؟" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "بازگشت به پیشخوان" })).toHaveAttribute(
    "href",
    "/panel",
  );
  await expect(page.getByRole("heading", { name: "ورود به دستیار لیارا" })).toHaveCount(0);
});

test("opens the assistant with a docs-aware welcome", async ({ page }) => {
  await page.goto("/assistant?source=docs");

  await expect(
    page.getByRole("heading", { name: "در مستندات دنبال چه چیزی هستی؟" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "بازگشت به مستندات" })).toHaveAttribute(
    "href",
    "/docs",
  );
});

test("falls back safely for an unknown assistant source", async ({ page }) => {
  await page.goto("/assistant?source=%3Cscript%3Ealert(1)%3C%2Fscript%3E");

  await expect(page.getByRole("heading", { name: "چه مشکلی در لیارا داری؟" })).toBeVisible();
  await expect(page.getByText("<script>alert(1)</script>")).toHaveCount(0);
});

test("moves from the empty panel into the panel-aware assistant", async ({ page }) => {
  await page.goto("/panel");

  await expect(page.getByRole("heading", { name: "هنوز برنامه‌ای نساخته‌اید" })).toBeVisible();
  await page.getByRole("link", { name: "شروع با دستیار لیارا" }).click();
  await expect(page).toHaveURL(/\/assistant\?source=panel$/);
  await expect(
    page.getByRole("heading", { name: "برای شروع روی لیارا چه کمکی می‌خواهی؟" }),
  ).toBeVisible();
});

test("moves from docs into the docs-aware assistant", async ({ page }) => {
  await page.goto("/docs");

  await expect(page.getByRole("heading", { name: "به مستندات لیارا خوش آمدید" })).toBeVisible();
  await page.getByRole("searchbox", { name: "جستجو در مستندات" }).fill("اتصال دامنه");
  await expect(page.getByRole("status")).toContainText("جستجوی زنده در این شبیه‌سازی فعال نیست");
  await page.getByRole("link", { name: "از دستیار بپرس" }).click();
  await expect(page).toHaveURL(/\/assistant\?source=docs$/);
  await expect(page.getByRole("heading", { name: "در مستندات دنبال چه چیزی هستی؟" })).toBeVisible();
});
