import { test, expect, Page, Browser } from "@playwright/test";
import fs from "node:fs";

// Сценарий «вдвоём»: основной аккаунт (e2e/.auth/user.json) и второй (e2e/.auth/friend.json,
// создаётся командой npm run test:e2e:login2). Оба работают одновременно в двух окнах.
// Тест сам наводит порядок до и после: удаляет дружбу между аккаунтами и свои тестовые данные.

const FRIEND_SESSION = "e2e/.auth/friend.json";

async function openAs(browser: Browser, storageState: string): Promise<Page> {
  const context = await browser.newContext({ storageState });
  return context.newPage();
}

// Прямые запросы к Supabase от имени пользователя, который открыт на странице — только для уборки
async function api(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Мои тетради" })).toBeVisible({ timeout: 15_000 });
  const session = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("sb-") && k.endsWith("-auth-token"))!;
    const s = JSON.parse(localStorage.getItem(key)!);
    return { token: s.access_token as string, userId: s.user.id as string };
  });
  const env = fs.readFileSync(".env", "utf8");
  const url = env.match(/VITE_SUPABASE_URL=(.*)/)![1].trim().replace(/"/g, "");
  const anon = env.match(/VITE_SUPABASE_ANON_KEY=(.*)/)![1].trim().replace(/"/g, "");
  const del = (path: string) =>
    fetch(`${url}/rest/v1/${path}`, { method: "DELETE", headers: { apikey: anon, Authorization: `Bearer ${session.token}` } });
  return { userId: session.userId, del };
}

async function cleanup(me: Page, friend: Page) {
  const a = await api(me);
  const b = await api(friend);
  // Дружба и заявки между двумя тестовыми аккаунтами (удалять может любая сторона)
  await a.del(`friend_requests?or=(and(from_id.eq.${a.userId},to_id.eq.${b.userId}),and(from_id.eq.${b.userId},to_id.eq.${a.userId}))`);
  // Только свои данные («E2E общая …»): другие тесты в это же время работают параллельно
  // с тем же аккаунтом, и их «E2E …» трогать нельзя
  await a.del(`groups?owner_id=eq.${a.userId}&name=like.E2E%20общая*`);
  await a.del(`notebooks?owner_id=eq.${a.userId}&title=like.E2E%20общая*`);
  return { meId: a.userId, friendId: b.userId };
}

async function publicIdOf(page: Page): Promise<string> {
  await page.goto("/");
  const text = await page.getByText(/^ID \d{4} \d{4}$/).first().textContent();
  return text!.replace(/\D/g, "");
}

test("вдвоём: дружба → поделиться тетрадью → группа и чат → вступление по ссылке", async ({ page, browser }) => {
  test.skip(!fs.existsSync(FRIEND_SESSION), "Нет второго аккаунта — выполните npm run test:e2e:login2");
  test.setTimeout(300_000);

  const me = page;
  const friend = await openAs(browser, FRIEND_SESSION);
  await cleanup(me, friend);
  const stamp = Date.now();

  // --- 1. Заявка в друзья по ID ---
  const friendPublicId = await publicIdOf(friend);
  await me.goto("/friends");
  await me.getByRole("button", { name: "+ Найти друга" }).click();
  await me.getByPlaceholder("Введите юзернейм или ID друга").fill(friendPublicId);
  await me.getByRole("button", { name: "Добавить" }).click();
  await expect(me.getByRole("button", { name: "Отправлено" })).toBeVisible({ timeout: 15_000 });
  await me.getByRole("button", { name: "Закрыть" }).click();

  // Красный счётчик заявок у друга
  await friend.goto("/");
  await expect(friend.locator('[aria-label="Заявок в друзья: 1"]:visible')).toBeVisible({ timeout: 15_000 });
  await friend.screenshot({ path: "screenshots/two-users-badge.png" });
  await friend.goto("/friends");
  await friend.getByRole("button", { name: "Принять" }).click();
  await expect(friend.locator('[aria-label="Заявок в друзья: 1"]:visible')).toHaveCount(0, { timeout: 15_000 });

  // --- 2. Поделиться тетрадью ---
  const nbTitle = `E2E общая тетрадь ${stamp}`;
  const noteText = "Второй закон Ньютона: F = ma";
  await me.goto("/");
  await me.getByRole("button", { name: "+ Новая тетрадь" }).click();
  await me.getByPlaceholder("Название тетради — придумайте своё").fill(nbTitle);
  await me.getByPlaceholder("Название тетради — придумайте своё").press("Enter");
  await me.getByText(nbTitle).click();
  const editor = me.locator('[contenteditable="true"]');
  await editor.click();
  await editor.type(noteText);
  await expect(me.getByText("Все изменения сохранены")).toBeVisible({ timeout: 15_000 });
  await me.getByRole("button", { name: "🔗 Поделиться" }).click();
  await me.getByRole("button", { name: /Открыть$/ }).first().click();
  await expect(me.getByText("✓ Открыта")).toBeVisible({ timeout: 15_000 });
  await me.getByRole("button", { name: "Готово" }).click();

  await friend.goto("/");
  await expect(friend.getByRole("heading", { name: "Со мной поделились" })).toBeVisible({ timeout: 15_000 });
  await friend.getByText(nbTitle).click();
  await expect(friend.getByText(noteText)).toBeVisible({ timeout: 15_000 });
  await expect(friend.getByText(/Только чтение · тетрадь @/)).toBeVisible();
  await expect(friend.locator('[contenteditable="true"]')).toHaveCount(0); // менять нельзя
  // Из чужого конспекта можно сделать себе карточку, но не раскрасить его
  await friend.getByText(noteText).selectText();
  await expect(friend.getByRole("button", { name: "🗂 В карточку" })).toBeVisible();
  await expect(friend.getByRole("button", { name: "Выделить розовый" })).toHaveCount(0);
  await friend.screenshot({ path: "screenshots/two-users-shared-notebook.png", fullPage: true });

  // --- 3. Группа: добавить друга → чат в обе стороны ---
  const groupName = `E2E общая группа ${stamp}`;
  await me.goto("/groups");
  await me.getByRole("button", { name: "+ Создать группу" }).click();
  await me.getByPlaceholder("Название, например «ФизФак 2027, поток Б»").fill(groupName);
  await me.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(me).toHaveURL(/\/groups\/[0-9a-f-]+$/, { timeout: 15_000 });
  const groupUrl = me.url();
  await me.getByRole("button", { name: "👥 Пригласить" }).click();
  await me.getByRole("button", { name: "Добавить" }).first().click();
  await expect(me.getByRole("button", { name: "✓ В группе" })).toBeVisible({ timeout: 15_000 });
  const inviteLink = await me.getByLabel("Ссылка").inputValue();
  await me.getByRole("button", { name: "Готово" }).click();
  await expect(me.getByRole("button", { name: /участники: 2/ })).toBeVisible();

  await friend.goto("/groups");
  await friend.getByText(groupName).click();
  await expect(friend.getByPlaceholder(/^Сообщение…/)).toBeVisible({ timeout: 15_000 });
  await me.waitForTimeout(1500); // подписки на чат подключаются

  const fromFriend = `Привет от друга ${stamp}`;
  await friend.getByPlaceholder(/^Сообщение…/).fill(fromFriend);
  await friend.getByPlaceholder(/^Сообщение…/).press("Enter");
  await expect(me.locator("p", { hasText: fromFriend })).toBeVisible({ timeout: 15_000 }); // пришло без обновления страницы

  const fromMe = `И тебе привет ${stamp}`;
  await me.getByPlaceholder(/^Сообщение…/).fill(fromMe);
  await me.getByPlaceholder(/^Сообщение…/).press("Enter");
  await expect(friend.locator("p", { hasText: fromMe })).toBeVisible({ timeout: 15_000 });
  await friend.screenshot({ path: "screenshots/two-users-chat.png", fullPage: true });

  // --- 4. Общая тетрадь группы: оба пишут, правки приходят сразу, чужое не затирается ---
  const gnbTitle = `E2E общая тетрадь группы ${stamp}`;
  await me.getByRole("tab", { name: "📚 Тетради группы" }).click();
  await me.getByRole("button", { name: "+ Тетрадь группы" }).click();
  await me.getByLabel("Название тетради группы").fill(gnbTitle);
  await me.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(me).toHaveURL(/\/notebook\//, { timeout: 15_000 });
  const gnbUrl = me.url();
  const myEditor = me.locator('[contenteditable="true"]');
  await myEditor.click();
  await myEditor.type("Лекция 1: пределы.");
  await expect(me.getByText("Все изменения сохранены")).toBeVisible({ timeout: 15_000 });
  await expect(me.getByText(/Тетрадь группы/)).toBeVisible();
  await expect(me.getByRole("button", { name: "🔗 Поделиться" })).toBeVisible(); // автор может делиться

  // Друг находит тетрадь во вкладке группы и дописывает — это не «только чтение»
  await friend.goto(groupUrl + "?tab=notebooks");
  await friend.getByText(gnbTitle).click();
  const friendEditor = friend.locator('[contenteditable="true"]');
  await expect(friendEditor).toHaveText("Лекция 1: пределы.", { timeout: 15_000 });
  await expect(friend.getByRole("button", { name: "🔗 Поделиться" })).toHaveCount(0); // не автор
  await expect(friend.getByRole("button", { name: "Удалить тетрадь" })).toHaveCount(0);
  await me.waitForTimeout(1500); // подписки на правки страницы подключаются
  await friendEditor.click();
  await friend.keyboard.press("End");
  await friendEditor.type(" Дописал друг.");
  await expect(friend.getByText("Все изменения сохранены")).toBeVisible({ timeout: 15_000 });
  // Правка друга пришла ко мне сама, без обновления страницы
  await expect(myEditor).toContainText("Дописал друг.", { timeout: 15_000 });
  await expect(me.getByText(/последнее изменение: @/)).toBeVisible({ timeout: 15_000 });

  // Конфликт: я печатаю без интернета, друг тем временем сохраняет свою правку
  await me.context().setOffline(true);
  await myEditor.click();
  await me.keyboard.press("End");
  await myEditor.type(" Моя правка офлайн.");
  await me.waitForTimeout(1500); // сохранение не прошло — нет сети
  await friendEditor.click();
  await friend.keyboard.press("End");
  await friendEditor.type(" Вторая правка друга.");
  await expect(friend.getByText("Все изменения сохранены")).toBeVisible({ timeout: 15_000 });
  await me.context().setOffline(false);
  await myEditor.type("!"); // следующее сохранение обнаружит, что страницу уже изменили
  await expect(me.getByRole("alert")).toContainText("изменил другой участник", { timeout: 15_000 });
  await me.screenshot({ path: "screenshots/group-notebook-conflict.png", fullPage: true });
  await me.getByRole("button", { name: "Сохранить мою поверх" }).click();
  await expect(me.getByRole("alert")).toHaveCount(0, { timeout: 15_000 });
  await friend.reload();
  await expect(friend.locator('[contenteditable="true"]')).toContainText("Моя правка офлайн.", { timeout: 15_000 });
  await friend.screenshot({ path: "screenshots/group-notebook.png", fullPage: true });

  // Уборка тетради группы (её автор — я)
  await me.goto(gnbUrl);
  await me.getByRole("button", { name: "Удалить тетрадь" }).click();
  await me.getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(me).toHaveURL(/\/$/, { timeout: 15_000 });
  await me.goto(groupUrl);
  await friend.goto(groupUrl);
  await expect(friend.getByPlaceholder(/^Сообщение…/)).toBeVisible({ timeout: 15_000 });

  // --- 5. Друг выходит и возвращается по ссылке-приглашению ---
  // Только внутри страницы: в боковой панели есть другая «Выйти» — выход из аккаунта
  const groupArea = friend.locator("main");
  await groupArea.getByRole("button", { name: "Выйти", exact: true }).click(); // «Выйти» из группы (в шапке)
  await groupArea.getByRole("button", { name: "Выйти", exact: true }).last().click(); // подтверждение
  await expect(friend).toHaveURL(/\/groups$/, { timeout: 15_000 });
  await expect(friend.getByText(groupName)).toHaveCount(0);
  await friend.goto(new URL(inviteLink).pathname);
  await expect(friend).toHaveURL(groupUrl, { timeout: 15_000 });
  await expect(friend.getByText(fromFriend)).toBeVisible();

  // --- Уборка: дружба удалена → база сама закрывает доступ к тетради (migration_010) ---
  await cleanup(me, friend);
  await friend.goto("/");
  await expect(friend.getByRole("heading", { name: "Мои тетради" })).toBeVisible({ timeout: 15_000 });
  await expect(friend.getByRole("heading", { name: "Со мной поделились" })).toHaveCount(0);
  await friend.context().close();
});
