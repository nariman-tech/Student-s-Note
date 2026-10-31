// Офлайн-режим.
//
// Как это устроено:
//  • Всё, что приложение загрузило из сети (тетради, страницы, флеш-карты, группы, профиль), копируется
//    в IndexedDB браузера. Без интернета те же функции отдают последнюю сохранённую копию.
//  • Правки страниц без интернета не теряются: они ложатся в «очередь на отправку» (outbox) и
//    уходят на сервер сами, как только сеть вернётся. Если за это время страницу изменил кто-то
//    другой, ничего не затираем — офлайн-версия сохраняется отдельной страницей «(офлайн-копия)».
//  • Сами файлы приложения и картинки из конспектов кэширует service worker (public/sw.js).
//  • Всё, что требует сервера по смыслу (создать группу, отправить сообщение, найти друга), без сети
//    показывает понятную ошибку.
//
// Кэш привязан к пользователю: ключи начинаются с его id, а при выходе и удалении аккаунта он стирается.

import { useEffect, useState } from "react";

const DB_NAME = "lectiva-offline";
const DB_VERSION = 1;
const KV = "kv"; // кэш ответов: ключ → данные
const OUTBOX = "outbox"; // неотправленные правки страниц: id страницы → правка

export const OFFLINE_CHANGED = "lectiva-offline-changed"; // очередь изменилась / синхронизация прошла

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
        if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => (dbPromise = null));
  }
  return dbPromise;
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

// IndexedDB может быть недоступна (приватное окно в некоторых браузерах) — тогда офлайн-режим
// просто не работает, а приложение ведёт себя как раньше
async function safe<T>(p: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await p();
  } catch {
    return fallback;
  }
}

export const kvGet = <T>(key: string) => safe(() => run<T | undefined>(KV, "readonly", (s) => s.get(key)), undefined);
export const kvSet = (key: string, value: unknown) => safe(() => run(KV, "readwrite", (s) => s.put(value, key)).then(() => undefined), undefined);

// --- Сеть ---

export function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

// Ошибка из-за отсутствия сети (а не «нет прав» или «не найдено»)?
export function isNetworkError(err: unknown): boolean {
  if (!isOnline()) return true;
  const msg = String((err as any)?.message ?? err ?? "");
  return err instanceof TypeError || /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(msg);
}

export class OfflineError extends Error {
  constructor(message = "Нет подключения к интернету — это действие доступно только онлайн") {
    super(message);
  }
}

export function requireOnline(what?: string) {
  if (!isOnline()) throw new OfflineError(what ? `${what} — нужен интернет` : undefined);
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(isOnline());
  useEffect(() => {
    const update = () => setOnline(isOnline());
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

// --- Чтение с кэшем ---

let cacheUser = ""; // id текущего пользователя — префикс ключей

export function setOfflineUser(userId: string) {
  cacheUser = userId;
  try {
    localStorage.setItem("lectiva-offline-user", userId);
  } catch {}
}

export function lastOfflineUser(): string | null {
  try {
    return localStorage.getItem("lectiva-offline-user");
  } catch {
    return null;
  }
}

// Загрузить из сети и запомнить; без сети — вернуть сохранённую копию.
// Если копии нет — пробрасываем исходную ошибку (страница покажет, что данных нет)
export async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const fullKey = `${cacheUser}:${key}`;
  if (!isOnline()) {
    const saved = await kvGet<T>(fullKey);
    if (saved !== undefined) return saved;
    throw new OfflineError("Эти данные ещё не сохранены для работы без интернета — откройте их один раз онлайн");
  }
  try {
    const fresh = await load();
    void kvSet(fullKey, fresh);
    return fresh;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const saved = await kvGet<T>(fullKey);
    if (saved !== undefined) return saved;
    throw err;
  }
}

// Обновить сохранённую копию, не дожидаясь сети (после офлайн-правки страницы)
export function updateCached<T>(key: string, update: (old: T | undefined) => T | undefined) {
  const fullKey = `${cacheUser}:${key}`;
  return kvGet<T>(fullKey).then((old) => {
    const next = update(old);
    if (next !== undefined) return kvSet(fullKey, next);
  });
}

// --- Очередь правок страниц ---

export interface PendingPageSave {
  pageId: string;
  notebookId: string;
  title?: string;
  content: string;
  attachments: unknown[];
  baseUpdatedAt: string | null; // версия страницы, с которой начали править
  savedAt: string;
}

export async function queuePageSave(save: PendingPageSave) {
  await safe(() => run(OUTBOX, "readwrite", (s) => s.put(save, `${cacheUser}:${save.pageId}`)), undefined);
  window.dispatchEvent(new Event(OFFLINE_CHANGED));
}

export async function pendingPageSaves(): Promise<PendingPageSave[]> {
  const all = await safe(
    () =>
      openDb().then(
        (db) =>
          new Promise<{ key: string; value: PendingPageSave }[]>((resolve, reject) => {
            const out: { key: string; value: PendingPageSave }[] = [];
            const req = db.transaction(OUTBOX, "readonly").objectStore(OUTBOX).openCursor();
            req.onsuccess = () => {
              const cursor = req.result;
              if (!cursor) return resolve(out);
              out.push({ key: String(cursor.key), value: cursor.value });
              cursor.continue();
            };
            req.onerror = () => reject(req.error);
          })
      ),
    []
  );
  return all.filter((e) => e.key.startsWith(`${cacheUser}:`)).map((e) => e.value);
}

export async function pendingPageSave(pageId: string): Promise<PendingPageSave | undefined> {
  return safe(() => run<PendingPageSave | undefined>(OUTBOX, "readonly", (s) => s.get(`${cacheUser}:${pageId}`)), undefined);
}

export async function dropPageSave(pageId: string) {
  await safe(() => run(OUTBOX, "readwrite", (s) => s.delete(`${cacheUser}:${pageId}`)), undefined);
  window.dispatchEvent(new Event(OFFLINE_CHANGED));
}

export function usePendingCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const refresh = () => pendingPageSaves().then((p) => setCount(p.length));
    refresh();
    window.addEventListener(OFFLINE_CHANGED, refresh);
    window.addEventListener("online", refresh);
    return () => {
      window.removeEventListener(OFFLINE_CHANGED, refresh);
      window.removeEventListener("online", refresh);
    };
  }, []);
  return count;
}

// --- Очистка ---

// При выходе из аккаунта и при удалении — чтобы следующий человек на этом устройстве
// не увидел чужие конспекты без интернета
export async function clearOfflineData() {
  try {
    localStorage.removeItem("lectiva-offline-user");
  } catch {}
  const db = await openDb().catch(() => null);
  if (db) {
    db.close();
    dbPromise = null;
  }
  await new Promise<void>((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
  // Картинки из конспектов в кэше service worker
  if ("caches" in window) await caches.delete("lectiva-files").catch(() => false);
}
