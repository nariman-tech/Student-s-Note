import { test, expect } from "@playwright/test";

test("страница входа (десктоп)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Войти через Google" })).toBeVisible();
  await page.screenshot({ path: "screenshots/login-desktop.png", fullPage: true });
});

test("переключение на регистрацию", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Регистрация" }).click();
  await page.screenshot({ path: "screenshots/register-desktop.png", fullPage: true });
});

test("страница входа (мобильный)", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Войти через Google" })).toBeVisible();
  await page.screenshot({ path: "screenshots/login-mobile.png", fullPage: true });
});

test("«Забыли пароль?» открывает форму сброса и возвращает ко входу", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Забыли пароль?" }).click();
  await expect(page.getByText("Введите почту — пришлём ссылку для сброса пароля.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Прислать ссылку" })).toBeVisible();
  await page.screenshot({ path: "screenshots/forgot-password.png", fullPage: true });
  await page.getByRole("button", { name: "← Вернуться ко входу" }).click();
  await expect(page.getByPlaceholder("Пароль")).toBeVisible();
});
