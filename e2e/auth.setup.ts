import { test as setup, expect } from "@playwright/test";
import fs from "node:fs";

const SESSION_FILE = "e2e/.auth/user.json";

// Сессия для тестов берётся одним из двух способов:
// 1) npm run test:e2e:login — вы сами входите в открывшемся окне, сессия сохраняется в файл;
// 2) .env.e2e с E2E_EMAIL / E2E_PASSWORD — тест входит через форму логина.
setup("вход в тестовый аккаунт", async ({ page }) => {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) {
    if (fs.existsSync(SESSION_FILE)) return; // используем сессию из npm run test:e2e:login
    throw new Error("Нет сохранённой сессии — выполните npm run test:e2e:login и войдите в открывшемся окне");
  }

  await page.goto("/");
  await page.getByPlaceholder("Почта").fill(email);
  await page.getByPlaceholder("Пароль").fill(password);
  await page.locator("form").getByRole("button", { name: "Войти" }).click();

  const error = page.locator("p.text-coral");
  const sidebar = page.getByRole("link", { name: /Тетради/ });
  await expect(sidebar.or(error)).toBeVisible({ timeout: 15_000 });
  if (await error.isVisible()) {
    await page.screenshot({ path: "screenshots/login-error.png", fullPage: true });
    throw new Error(`Supabase вернул ошибку входа: ${await error.textContent()}`);
  }

  await page.context().storageState({ path: SESSION_FILE });
});
