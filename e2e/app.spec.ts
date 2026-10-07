import { test, expect, Page } from "@playwright/test";
import nodeFs from "node:fs";

// Все тесты создают свои данные с пометкой "E2E …" и удаляют их за собой.

// Маленькая PNG 1x1 — прямо в тесте, без отдельного файла
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

// Куда приложение сейчас загружает файлы: Backblaze B2 через Worker (VITE_FILES_WORKER_URL в .env)
// или Supabase Storage. Тесты проверяют то хранилище, которое реально используется
function filesPrefix(): string {
  const env = nodeFs.readFileSync(".env", "utf8");
  const worker = env.match(/^VITE_FILES_WORKER_URL=(.*)$/m)?.[1].trim().replace(/"/g, "").replace(/\/$/, "");
  return worker ? `${worker}/f/` : "/storage/v1/object/public/uploads/";
}

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

async function confirmDelete(page: Page, label = "Удалить") {
  await page.getByRole("button", { name: label, exact: true }).click();
}

const pages = [
  { path: "/", name: "notebooks", heading: "Мои тетради" },
  { path: "/flashcards", name: "flashcards", heading: "Модули флеш-карт" },
  { path: "/groups", name: "groups", heading: "Группы" },
  { path: "/friends", name: "friends", heading: "Друзья" },
];

for (const p of pages) {
  test(`страница ${p.name} открывается без ошибок`, async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto(p.path);
    await expect(page.getByRole("heading", { name: p.heading, exact: true })).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `screenshots/app-${p.name}.png`, fullPage: true });
    expect(errors, "ошибки JS на странице").toEqual([]);
  });
}

test("тетрадь: создание с обложкой → переименование → удаление", async ({ page }) => {
  const title = `E2E тетрадь ${Date.now()}`;
  await page.goto("/");
  await page.getByRole("button", { name: "+ Новая тетрадь" }).click();
  await page.getByPlaceholder("Название тетради — придумайте своё").fill(title);
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: PNG });

  // Обложка должна уйти в Storage, а в базу — только ссылка
  const insert = page.waitForRequest((r) => r.url().includes("/rest/v1/notebooks") && r.method() === "POST");
  await page.getByPlaceholder("Название тетради — придумайте своё").press("Enter");
  const body = (await insert).postDataJSON();
  expect(body.cover_image_url).toContain(filesPrefix());

  await page.getByText(title).click();
  await expect(page).toHaveURL(/\/notebook\//);
  await expect(page.getByAltText("Обложка")).toBeVisible();
  // В PDF (печатной версии) обложки нет — только сам конспект
  await page.emulateMedia({ media: "print" });
  await expect(page.getByAltText("Обложка")).toBeHidden();
  await page.emulateMedia({ media: "screen" });

  await page.getByRole("button", { name: "Переименовать тетрадь" }).click();
  const renamed = `${title} (переименована)`;
  await page.getByLabel("Название тетради").fill(renamed);
  await page.getByLabel("Название тетради").press("Enter");
  await expect(page.getByRole("heading", { name: renamed })).toBeVisible();
  await page.screenshot({ path: "screenshots/app-notebook-editor.png", fullPage: true });

  await page.getByRole("button", { name: "Удалить тетрадь" }).click();
  await confirmDelete(page);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(renamed)).toHaveCount(0);
});

test("флеш-карты: создание → изменение → удаление", async ({ page }) => {
  const title = `E2E модуль ${Date.now()}`;
  await page.goto("/flashcards");
  await page.getByRole("button", { name: "+ Создать модуль" }).click();
  await page.getByPlaceholder("Название модуля, например «Формулы — механика»").fill(title);
  await page.getByPlaceholder("Термин").first().fill("Сила");
  await page.getByPlaceholder("Определение").first().fill("F = ma");
  await page.getByRole("button", { name: "Создать модуль", exact: true }).click();

  await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Сила")).toBeVisible();

  await page.getByRole("button", { name: "✏️ Изменить" }).click();
  await page.getByPlaceholder("Термин").first().fill("Импульс");
  await page.getByPlaceholder("Определение").first().fill("p = mv");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Импульс")).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: "screenshots/app-flashcards-study.png", fullPage: true });

  await page.getByRole("button", { name: "Удалить модуль" }).click();
  await confirmDelete(page);
  await expect(page.getByRole("heading", { name: "Модули флеш-карт" })).toBeVisible();
  await expect(page.getByText(title)).toHaveCount(0);
});

test("группа: создание → сообщение → фото в чате → удаление", async ({ page }) => {
  const errors = trackErrors(page);
  const name = `E2E группа ${Date.now()}`;
  await page.goto("/groups");
  await page.getByRole("button", { name: "+ Создать группу" }).click();
  await page.getByPlaceholder("Название, например «ФизФак 2027, поток Б»").fill(name);
  await page.getByRole("button", { name: "Создать", exact: true }).click();

  await expect(page).toHaveURL(/\/groups\/[0-9a-f-]+$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByText(/Код:/)).toBeVisible();

  const composer = page.getByPlaceholder(/^Сообщение…/);
  const text = `Привет из автотеста ${Date.now()}`;
  await composer.fill(text);
  await composer.press("Enter");
  // Поле очистилось — отправка завершилась; сообщение ищем в ленте (<p>), а не в поле ввода
  await expect(composer).toHaveValue("", { timeout: 15_000 });
  await expect(page.locator("p", { hasText: text })).toBeVisible({ timeout: 15_000 });

  // Сообщение из второй вкладки должно прийти в первую само — через Supabase Realtime
  const page2 = await page.context().newPage();
  await page2.goto(page.url());
  const composer2 = page2.getByPlaceholder(/^Сообщение…/);
  await expect(composer2).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1500); // даём подписке на чат подключиться
  const realtimeText = `Из второй вкладки ${Date.now()}`;
  await composer2.fill(realtimeText);
  await composer2.press("Enter");
  await expect(page.getByText(realtimeText)).toBeVisible({ timeout: 15_000 });
  await page2.close();

  await page.locator('input[type="file"]').setInputFiles({ name: "board.png", mimeType: "image/png", buffer: PNG });
  await page.getByRole("button", { name: "Отправить" }).click();
  await expect(page.getByAltText("board.png")).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: "screenshots/app-group-chat.png", fullPage: true });

  await page.getByRole("button", { name: /участники: 1/ }).click();
  await expect(page.getByText("(вы)")).toBeVisible();
  await page.getByRole("button", { name: "Закрыть" }).click();

  await page.getByRole("button", { name: "🗑 Удалить группу" }).click();
  await confirmDelete(page);
  await expect(page).toHaveURL(/\/groups$/);
  await expect(page.getByText(name)).toHaveCount(0);
  expect(errors, "ошибки JS на странице").toEqual([]);
});

test("вступление по несуществующему коду показывает понятную ошибку", async ({ page }) => {
  await page.goto("/groups");
  await page.getByRole("button", { name: "Вступить по коду" }).click();
  await page.getByPlaceholder(/Код, например/).fill("ZZZZZZZZ");
  await page.getByRole("button", { name: "Вступить", exact: true }).click();
  await expect(page.getByText("Группа с таким кодом не найдена — проверьте код")).toBeVisible({ timeout: 15_000 });
});

test("настройки профиля открываются и показывают ID", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("Настройки профиля").click();
  await expect(page.getByRole("heading", { name: "Профиль" })).toBeVisible();
  await expect(page.getByText(/Ваш ID:/)).toBeVisible();
  await page.screenshot({ path: "screenshots/app-profile.png" });
  await page.getByRole("button", { name: "Отмена" }).click();
});

test("доступ по ссылке: тетрадь открывается без аккаунта, после выключения — нет; PDF", async ({ page, browser }) => {
  const title = `E2E ссылка ${Date.now()}`;
  await page.goto("/");
  await page.getByRole("button", { name: "+ Новая тетрадь" }).click();
  await page.getByPlaceholder("Название тетради — придумайте своё").fill(title);
  await page.getByPlaceholder("Название тетради — придумайте своё").press("Enter");
  await page.getByText(title).click();
  await expect(page).toHaveURL(/\/notebook\//);

  const noteText = "Закон Ома: I = U / R";
  const editor = page.locator('[contenteditable="true"]');
  await editor.click();
  await editor.type(noteText);
  await expect(page.getByText("Все изменения сохранены")).toBeVisible({ timeout: 15_000 });

  // PDF: печатная версия — только конспект, без боковой панели и кнопок
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("button", { name: "Выйти" })).toBeHidden();
  await page.pdf({ path: "screenshots/notebook-export.pdf", format: "A4" });
  await page.emulateMedia({ media: "screen" });

  // Включаем доступ по ссылке
  await page.getByRole("button", { name: "🔗 Поделиться" }).click();
  await page.getByRole("switch", { name: "Доступ по ссылке" }).click();
  const link = await page.getByLabel("Ссылка").inputValue();
  expect(link).toMatch(/\/s\/n\/[A-Za-z0-9]{24}$/);
  await expect(page.getByRole("link", { name: /Telegram/ })).toHaveAttribute("href", /t\.me\/share/);
  await page.screenshot({ path: "screenshots/share-link.png" });

  // Открываем ссылку в браузере без входа в аккаунт
  const guest = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const guestPage = await guest.newPage();
  await guestPage.goto(new URL(link).pathname);
  await expect(guestPage.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });
  await expect(guestPage.getByText(noteText)).toBeVisible();
  await guestPage.screenshot({ path: "screenshots/public-notebook.png", fullPage: true });

  // Выключаем — ссылка перестаёт работать
  await page.getByRole("switch", { name: "Доступ по ссылке" }).click();
  await expect(page.getByLabel("Ссылка")).toHaveCount(0);
  await guestPage.reload();
  await expect(guestPage.getByText("Тетрадь недоступна по этой ссылке")).toBeVisible({ timeout: 15_000 });
  await guest.close();

  await page.getByRole("button", { name: "Готово" }).click();
  await page.getByRole("button", { name: "Удалить тетрадь" }).click();
  await confirmDelete(page);
  await expect(page).toHaveURL(/\/$/);
});

test("группа: окно «Пригласить» показывает друзей и ссылку-приглашение", async ({ page }) => {
  const name = `E2E приглашение ${Date.now()}`;
  await page.goto("/groups");
  await page.getByRole("button", { name: "+ Создать группу" }).click();
  await page.getByPlaceholder("Название, например «ФизФак 2027, поток Б»").fill(name);
  await page.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(page).toHaveURL(/\/groups\/[0-9a-f-]+$/, { timeout: 15_000 });

  await page.getByRole("button", { name: "👥 Пригласить" }).click();
  await expect(page.getByRole("heading", { name: "Пригласить в группу" })).toBeVisible();
  const link = await page.getByLabel("Ссылка").inputValue();
  expect(link).toMatch(/\/join\/[A-Z0-9]{8}$/);
  await page.screenshot({ path: "screenshots/group-invite.png" });
  await page.getByRole("button", { name: "Готово" }).click();

  await page.getByRole("button", { name: "🗑 Удалить группу" }).click();
  await confirmDelete(page);
  await expect(page).toHaveURL(/\/groups$/);
});

test("рисование: панель загружается по кнопке, снимок прикрепляется к конспекту", async ({ page }) => {
  const errors = trackErrors(page);
  const title = `E2E рисование ${Date.now()}`;
  await page.goto("/");
  await page.getByRole("button", { name: "+ Новая тетрадь" }).click();
  await page.getByPlaceholder("Название тетради — придумайте своё").fill(title);
  await page.getByPlaceholder("Название тетради — придумайте своё").press("Enter");
  await page.getByText(title).click();
  await expect(page).toHaveURL(/\/notebook\//);

  await page.getByRole("button", { name: "✏️ Рисовать" }).click();
  await expect(page.getByTitle("Перетащить панель")).toBeVisible({ timeout: 15_000 }); // модуль рисования подгрузился
  const canvas = page.locator("canvas").first();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 90, { steps: 8 });
  await page.mouse.up();
  await page.getByTitle("Сделать снимок и прикрепить").click();
  await expect(page.getByAltText("Решение.webp")).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Удалить тетрадь" }).click();
  await confirmDelete(page);
  await expect(page).toHaveURL(/\/$/);
  expect(errors, "ошибки JS на странице").toEqual([]);
});

test("поиск находит тетрадь по тексту конспекта: часть слова и другая словоформа", async ({ page }) => {
  test.setTimeout(90_000); // длинный сценарий: тетрадь → текст → три поиска → уборка
  const title = `E2E поиск ${Date.now()}`;
  await page.goto("/");
  await page.getByRole("button", { name: "+ Новая тетрадь" }).click();
  await page.getByPlaceholder("Название тетради — придумайте своё").fill(title);
  await page.getByPlaceholder("Название тетради — придумайте своё").press("Enter");
  await page.getByText(title).click();
  const editor = page.locator('[contenteditable="true"]');
  await editor.click();
  await editor.type("Фотосинтез происходит в хлоропластах растений под действием света.");
  await expect(page.getByText("Все изменения сохранены")).toBeVisible({ timeout: 15_000 });
  const notebookUrl = page.url();

  const search = async (q: string) => {
    await page.goto("/");
    const box = page.getByLabel("Поиск по тетрадям и конспектам");
    await box.fill(q);
    return page.getByRole("button", { name: new RegExp(title) });
  };

  // Начало слова, пока его печатают: «хлороп» → «хлоропластах», с подсветкой в кусочке текста
  let result = await search("хлороп");
  await expect(result).toBeVisible({ timeout: 15_000 });
  await expect(result.locator("mark")).toContainText("хлоропластах");
  await page.screenshot({ path: "screenshots/search.png" });

  // Другая словоформа: «растение» находит «растений»
  result = await search("растение");
  await expect(result).toBeVisible({ timeout: 15_000 });

  // Слова нет в тексте — тетрадь не находится
  await search("квантовая хромодинамика");
  await expect(page.getByText(/Ничего не нашлось/)).toBeVisible({ timeout: 15_000 });

  await page.goto(notebookUrl);
  await page.getByRole("button", { name: "Удалить тетрадь" }).click();
  await confirmDelete(page);
  await expect(page).toHaveURL(/\/$/);
});

test("страницы тетради: добавить, переключить, переименовать, сдвинуть, удалить; PDF всей тетради", async ({ page }) => {
  const title = `E2E страницы ${Date.now()}`;
  await page.goto("/");
  await page.getByRole("button", { name: "+ Новая тетрадь" }).click();
  await page.getByPlaceholder("Название тетради — придумайте своё").fill(title);
  await page.getByPlaceholder("Название тетради — придумайте своё").press("Enter");
  await page.getByText(title).click();

  // В новой тетради сразу есть «Страница 1»
  const tab = (name: string | RegExp) => page.getByRole("tab", { name });
  await expect(tab("Страница 1")).toHaveAttribute("aria-selected", "true", { timeout: 15_000 });
  const editor = page.locator('[contenteditable="true"]');
  await editor.click();
  await editor.type("Кинематика: скорость и ускорение");
  await expect(page.getByText("Все изменения сохранены")).toBeVisible({ timeout: 15_000 });

  // Вторая страница: свой текст, первая при этом не меняется
  await page.getByRole("button", { name: "+ Страница" }).click();
  await expect(tab("Страница 2")).toHaveAttribute("aria-selected", "true", { timeout: 15_000 });
  await expect(editor).toHaveText("");
  await editor.click();
  await editor.type("Динамика: законы Ньютона");
  // Сразу переключаемся — несохранённый набор не должен потеряться
  await tab("Страница 1").click();
  await expect(editor).toHaveText("Кинематика: скорость и ускорение", { timeout: 15_000 });
  await tab("Страница 2").click();
  await expect(editor).toHaveText("Динамика: законы Ньютона", { timeout: 15_000 });

  // Переименовать открытую страницу
  await page.getByRole("button", { name: "✏️ Переименовать страницу" }).click();
  await page.getByLabel("Название страницы").fill("Лекция 2. Динамика");
  await page.getByLabel("Название страницы").press("Enter");
  await expect(tab("Лекция 2. Динамика")).toBeVisible();

  // Сдвинуть влево — теперь она первая, и порядок сохраняется после перезагрузки
  const reorder = page.waitForResponse((r) => r.url().includes("/rest/v1/notes") && r.request().method() === "PATCH");
  await page.getByRole("button", { name: "Сдвинуть страницу влево" }).click();
  await expect(page.getByRole("tab").first()).toHaveText("Лекция 2. Динамика");
  await reorder;
  await page.waitForLoadState("networkidle");
  await page.reload();
  await expect(page.getByRole("tab").first()).toHaveText("Лекция 2. Динамика", { timeout: 15_000 });
  await expect(editor).toHaveText("Динамика: законы Ньютона"); // ?page=… в адресе — открыта та же страница
  await page.screenshot({ path: "screenshots/notebook-pages.png", fullPage: true });

  // PDF всей тетради: для печати отрисованы обе страницы.
  // Окно печати в тесте заменяем заглушкой: без экрана браузер сразу сообщает «печать закончена»,
  // и приложение убирало бы печатную версию раньше, чем тест её проверит
  await page.evaluate(() => {
    window.print = () => {};
  });
  await page.getByRole("button", { name: "⬇️ PDF" }).click();
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("heading", { name: "Страница 1" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Лекция 2. Динамика" })).toBeVisible();
  await page.pdf({ path: "screenshots/notebook-pages.pdf", format: "A4" });
  await page.emulateMedia({ media: "screen" });

  // Удалить страницу
  await tab("Страница 1").click();
  await page.getByRole("button", { name: "🗑 Удалить страницу" }).click();
  await confirmDelete(page);
  await expect(tab("Страница 1")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole("tab")).toHaveCount(1);

  await page.getByRole("button", { name: "Удалить тетрадь" }).click();
  await confirmDelete(page);
  await expect(page).toHaveURL(/\/$/);
});

test("«В карточку»: выделенный текст конспекта становится флеш-картой", async ({ page }) => {
  test.setTimeout(90_000); // длинный сценарий: тетрадь → две карточки → флеш-карты → уборка
  const title = `E2E карточки ${Date.now()}`;
  await page.goto("/");
  await page.getByRole("button", { name: "+ Новая тетрадь" }).click();
  await page.getByPlaceholder("Название тетради — придумайте своё").fill(title);
  await page.getByPlaceholder("Название тетради — придумайте своё").press("Enter");
  await page.getByText(title).click();
  const notebookUrl = page.url();

  const editor = page.locator('[contenteditable="true"]');
  await editor.click();
  await editor.type("Сила — векторная величина, мера воздействия на тело");
  await expect(page.getByText("Все изменения сохранены")).toBeVisible({ timeout: 15_000 });

  // Выделяем текст → во всплывающей панели «В карточку»
  await editor.selectText();
  await page.getByRole("button", { name: "🗂 В карточку" }).click();
  await expect(page.getByRole("heading", { name: "Новая карточка" })).toBeVisible();
  // Текст сам разделился на термин и определение, модуль по умолчанию — новый, с названием тетради
  await expect(page.getByLabel("Термин (лицевая сторона)")).toHaveValue("Сила");
  await expect(page.getByLabel("Определение (обратная сторона)")).toHaveValue("векторная величина, мера воздействия на тело");
  await expect(page.getByLabel("Название нового модуля")).toHaveValue(title);
  await page.screenshot({ path: "screenshots/card-from-selection.png" });
  await page.getByRole("button", { name: "Создать карточку" }).click();
  await expect(page.getByRole("status")).toContainText(`Карточка добавлена в «${title}»`, { timeout: 15_000 });

  // Вторая карточка из той же тетради сама идёт в тот же модуль
  await editor.selectText();
  await page.getByRole("button", { name: "🗂 В карточку" }).click();
  await expect(page.getByLabel("Модуль флеш-карт")).not.toHaveValue("__new__", { timeout: 15_000 });
  await expect(page.getByLabel("Модуль флеш-карт").locator("option:checked")).toHaveText(title);
  await page.getByRole("button", { name: "Отмена" }).click();

  // Модуль появился во флеш-картах, карточка изучается
  await page.getByRole("status").getByRole("button", { name: "Открыть" }).click();
  await expect(page).toHaveURL(/\/flashcards$/);
  await page.getByRole("button", { name: new RegExp(title) }).first().click();
  await expect(page.getByText("Сила", { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByText("Сила", { exact: true }).click(); // переворачиваем
  await expect(page.getByText("векторная величина, мера воздействия на тело")).toBeVisible();
  await page.screenshot({ path: "screenshots/card-study.png" });

  // Уборка: модуль и тетрадь
  await page.getByRole("button", { name: "Удалить модуль" }).click();
  await confirmDelete(page);
  await page.goto(notebookUrl);
  await page.getByRole("button", { name: "Удалить тетрадь" }).click();
  await confirmDelete(page);
  await expect(page).toHaveURL(/\/$/);
});

test("отзыв: отправить; аналитика у администратора показывает числа и этот отзыв", async ({ page }) => {
  const text = `E2E отзыв ${Date.now()}: добавьте тёмную тему`;
  await page.goto("/");
  await page.getByRole("button", { name: "Отзыв" }).click();
  await expect(page.getByRole("heading", { name: "Как вам Lectiva?" })).toBeVisible();
  await page.getByRole("radio", { name: "Отлично" }).click();
  await page.getByRole("button", { name: "💡 Идея" }).click();
  await page.getByLabel("Текст отзыва").fill(text);
  await page.screenshot({ path: "screenshots/feedback.png" });
  await page.getByRole("button", { name: "Отправить" }).click();
  await expect(page.getByRole("heading", { name: "Спасибо за отзыв!" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Закрыть" }).click();

  // Страница аналитики — только если этот аккаунт сделан администратором (см. migration_014)
  await page.goto("/admin");
  const denied = page.getByText("Эта страница доступна только администратору приложения.");
  const heading = page.getByText("Активны сегодня");
  await expect(denied.or(heading)).toBeVisible({ timeout: 15_000 });
  test.skip(await denied.isVisible(), "Аккаунт не администратор — добавьте его в таблицу admins (migration_014)");

  // Я только что открыл приложение → минимум один активный сегодня; отправленный отзыв — в «Новых»
  await expect(page.getByText("Активны сегодня").locator("..").getByText(/^[1-9]/)).toBeVisible();
  const card = page.locator("div.rounded-card", { hasText: text });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText("💡 Идея")).toBeVisible();
  await page.screenshot({ path: "screenshots/admin-analytics.png", fullPage: true });
  await card.getByRole("button", { name: "✓ Разобрано" }).click();
  await expect(page.locator("div.rounded-card", { hasText: text })).toHaveCount(0); // ушёл из «Новых»
  await page.getByRole("button", { name: /^Все/ }).click();
  await expect(page.locator("div.rounded-card", { hasText: text }).getByRole("button", { name: "Вернуть в новые" })).toBeVisible();

  // Уборка: удаляем все тестовые отзывы (в том числе оставшиеся от прошлых запусков)
  const testCards = page.locator("div.rounded-card", { hasText: "E2E отзыв" });
  while ((await testCards.count()) > 0) {
    const before = await testCards.count();
    await testCards.first().getByRole("button", { name: "Удалить отзыв" }).click();
    await expect(testCards).toHaveCount(before - 1, { timeout: 15_000 });
  }
});

test("файлы в конспекте: у файла есть ссылка; убранные крестиком файлы удаляются из хранилища", async ({ page }) => {
  test.setTimeout(90_000);
  const fs = await import("node:fs");
  const title = `E2E файлы ${Date.now()}`;
  await page.goto("/");
  await page.getByRole("button", { name: "+ Новая тетрадь" }).click();
  await page.getByPlaceholder("Название тетради — придумайте своё").fill(title);
  await page.getByPlaceholder("Название тетради — придумайте своё").press("Enter");
  await page.getByText(title).click();
  const editor = page.locator('[contenteditable="true"]');
  await expect(editor).toBeVisible({ timeout: 15_000 });

  const attach = page.locator('label:has-text("Прикрепить файл") input[type="file"]');
  // Картинка
  await attach.setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: PNG });
  const img = editor.locator("[data-note-image] img");
  await expect(img).toBeVisible({ timeout: 15_000 });
  const imgUrl = (await img.getAttribute("src"))!;
  // Обычный файл — карточка должна быть ссылкой на файл в хранилище
  await attach.setInputFiles({ name: "конспект.txt", mimeType: "text/plain", buffer: Buffer.from("текст файла") });
  const fileLink = editor.locator("a[data-file-link]");
  await expect(fileLink).toBeVisible({ timeout: 15_000 });
  const fileUrl = (await fileLink.getAttribute("href"))!;
  expect(fileUrl).toContain(filesPrefix());
  await expect(page.getByText("Все изменения сохранены")).toBeVisible({ timeout: 30_000 }); // загрузка в B2 + сохранение

  // Есть ли файл в хранилище — спрашиваем Supabase от имени пользователя
  const env = fs.readFileSync(".env", "utf8");
  const url = env.match(/VITE_SUPABASE_URL=(.*)/)![1].trim().replace(/"/g, "");
  const anon = env.match(/VITE_SUPABASE_ANON_KEY=(.*)/)![1].trim().replace(/"/g, "");
  const exists = async (publicUrl: string) => {
    // B2 через Worker: файл есть, если Worker его отдаёт
    if (!publicUrl.includes("/storage/v1/object/public/uploads/")) {
      const r = await fetch(publicUrl, { method: "GET" });
      return r.status === 200;
    }
    // Supabase Storage: спрашиваем список файлов от имени пользователя
    const token = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.startsWith("sb-") && k.endsWith("-auth-token"))!;
      return JSON.parse(localStorage.getItem(key)!).access_token as string;
    });
    const path = publicUrl.split("/public/uploads/")[1];
    const [folder, name] = path.split("/");
    const r = await fetch(`${url}/storage/v1/object/list/uploads`, {
      method: "POST",
      headers: { apikey: anon, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: folder, search: name }),
    });
    const list = (await r.json()) as { name: string }[];
    return list.some((f) => f.name === name);
  };
  expect(await exists(imgUrl)).toBe(true);
  expect(await exists(fileUrl)).toBe(true);

  // PDF: картинка из конспекта попадает в печатную версию, а после сохранения PDF остаётся в конспекте
  await page.evaluate(() => {
    window.print = () => {};
  });
  await page.getByRole("button", { name: "⬇️ PDF" }).click();
  await page.emulateMedia({ media: "print" });
  const printedImg = page.locator(`section img[src="${imgUrl}"], [data-note-image] img[src="${imgUrl}"]`).first();
  await expect(printedImg).toBeVisible({ timeout: 15_000 });
  await page.pdf({ path: "screenshots/notebook-with-image.pdf", format: "A4" });
  await page.emulateMedia({ media: "screen" });
  await expect(img).toBeVisible(); // в самом конспекте картинка на месте
  expect(await exists(imgUrl)).toBe(true); // и в хранилище тоже

  // Убираем крестиками → после сохранения файлы удаляются из хранилища
  await editor.locator('[data-action="remove-image"]').click();
  await editor.locator('[data-action="remove-file"]').click();
  await expect(page.getByText("Все изменения сохранены")).toBeVisible({ timeout: 30_000 }); // загрузка в B2 + сохранение
  // Удаление идёт после сохранения страницы и проверки «не используется ли файл где-то ещё» — даём время
  await expect.poll(() => exists(imgUrl), { timeout: 30_000 }).toBe(false);
  await expect.poll(() => exists(fileUrl), { timeout: 30_000 }).toBe(false);

  await page.getByRole("button", { name: "Удалить тетрадь" }).click();
  await confirmDelete(page);
  await expect(page).toHaveURL(/\/$/);
});
