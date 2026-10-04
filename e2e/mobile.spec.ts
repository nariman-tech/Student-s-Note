import { test, expect, Page } from "@playwright/test";

// Приложение на телефоне (Pixel 7, ~412px по ширине): нижнее меню вместо боковой панели,
// ничего не вылезает за край экрана, чат и профиль удобны пальцем.

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "страница шире экрана телефона — появляется горизонтальная прокрутка").toBeLessThanOrEqual(1);
}

const tabs = [
  { tab: "Тетради", heading: "Мои тетради", file: "mobile-notebooks" },
  { tab: "Флеш-карты", heading: "Модули флеш-карт", file: "mobile-flashcards" },
  { tab: "Группы", heading: "Группы", file: "mobile-groups" },
  { tab: "Друзья", heading: "Друзья", file: "mobile-friends" },
];

test("нижнее меню: все вкладки открываются и помещаются по ширине", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Мои тетради" })).toBeVisible({ timeout: 15_000 });
  // Боковой панели на телефоне нет — её кнопка «Выйти» скрыта
  await expect(page.getByRole("button", { name: "Выйти", exact: true })).toBeHidden();

  for (const t of tabs) {
    await page.getByRole("link", { name: t.tab }).click();
    await expect(page.getByRole("heading", { name: t.heading, exact: true })).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `screenshots/${t.file}.png` });
  }
});

test("профиль на телефоне: открывается по аватарке, есть выход из аккаунта", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Профиль" }).click();
  await expect(page.getByRole("heading", { name: "Профиль" })).toBeVisible();
  await expect(page.getByRole("button", { name: "🚪 Выйти из аккаунта" })).toBeVisible();
  await page.screenshot({ path: "screenshots/mobile-profile.png" });
  await page.getByRole("button", { name: "Отмена" }).click(); // выходить не нужно — сессия пригодится другим тестам
});

test("тетрадь и чат группы на телефоне", async ({ page }) => {
  const stamp = Date.now();

  // Тетрадь: редактор и кнопки помещаются
  const title = `E2E телефон ${stamp}`;
  await page.goto("/");
  await page.getByRole("button", { name: "+ Новая тетрадь" }).click();
  await page.getByPlaceholder("Название тетради — придумайте своё").fill(title);
  await page.getByPlaceholder("Название тетради — придумайте своё").press("Enter");
  await page.getByText(title).click();
  await expect(page.getByRole("button", { name: "✏️ Рисовать" })).toBeVisible({ timeout: 15_000 });
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: "screenshots/mobile-editor.png", fullPage: true });
  await page.getByRole("button", { name: "Удалить тетрадь" }).click();
  await page.getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);

  // Группа: поле сообщения видно над нижним меню, сообщение отправляется
  const name = `E2E телефон группа ${stamp}`;
  await page.getByRole("link", { name: "Группы" }).click();
  await page.getByRole("button", { name: "+ Создать группу" }).click();
  await page.getByPlaceholder("Название, например «ФизФак 2027, поток Б»").fill(name);
  await page.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(page).toHaveURL(/\/groups\/[0-9a-f-]+$/, { timeout: 15_000 });

  const composer = page.getByPlaceholder(/^Сообщение…/);
  await expect(composer).toBeInViewport();
  const text = `Сообщение с телефона ${stamp}`;
  await composer.fill(text);
  await page.getByRole("button", { name: "Отправить" }).click();
  // Поле очистилось — отправка завершилась; сообщение ищем в ленте (<p>), а не в поле ввода
  await expect(composer).toHaveValue("", { timeout: 15_000 });
  await expect(page.locator("p", { hasText: text })).toBeVisible({ timeout: 15_000 });
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: "screenshots/mobile-group-chat.png" });

  await page.getByRole("button", { name: "🗑 Удалить группу" }).click();
  await page.getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(page).toHaveURL(/\/groups$/);
});
