import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";

// Логин/пароль тестового аккаунта лежат локально в .env.e2e (E2E_EMAIL, E2E_PASSWORD)
if (fs.existsSync(".env.e2e")) process.loadEnvFile(".env.e2e");

// Dev-сервер запускается отдельно (npm run dev); если он не запущен — Playwright поднимет его сам
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  // Тесты работают с настоящей облачной базой (Supabase): если она на секунду притормозила,
  // упавший тест повторяется один раз. Такие тесты в отчёте помечаются как flaky — их видно
  retries: 1,
  use: {
    baseURL: "http://localhost:1420",
  },
  projects: [
    { name: "public", testMatch: /login\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    { name: "setup", testMatch: /auth\.setup\.ts/, use: { ...devices["Desktop Chrome"] } },
    {
      name: "app",
      testMatch: /app\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/user.json" },
    },
    {
      // Телефон: нижнее меню вместо боковой панели, всё помещается по ширине экрана
      name: "mobile",
      testMatch: /mobile\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Pixel 7"], storageState: "e2e/.auth/user.json" },
    },
    {
      // Сценарии за двух пользователей: второй аккаунт — e2e/.auth/friend.json (npm run test:e2e:login2)
      name: "two-users",
      testMatch: /two-users\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/user.json" },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:1420",
    reuseExistingServer: true,
  },
});
