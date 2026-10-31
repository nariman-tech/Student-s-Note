// Удаление аккаунта (Настройки → «Удалить аккаунт»).
//
// Порядок важен:
//   1. Собираем файлы, которые должны остаться: на них ссылаются общие тетради групп и сообщения
//      в чатах — после удаления аккаунта они остаются у группы (см. migration_016_delete_account.sql).
//   2. Удаляем свои файлы из хранилищ (Supabase Storage и Backblaze через Worker). Это нужно сделать
//      до удаления аккаунта: потом хранилище уже не пустит — входа больше нет.
//   3. Вызываем delete_my_account() в базе: группы передаются участникам, остальное удаляется.
//   4. Выходим и чистим локальные данные (офлайн-кэш) на этом устройстве.

import { supabase } from "./supabase";
import { signOut } from "./auth";
import { clearOfflineData } from "./offline";

const BUCKET = "uploads";
const SUPABASE_FILES = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;
const WORKER = (import.meta.env.VITE_FILES_WORKER_URL ?? "").replace(/\/$/, "");
const WORKER_FILES = WORKER ? `${WORKER}/f/` : null;

export type DeletionStep = "collect" | "files" | "account" | "done";

// Пути {userId}/{файл} моих файлов, упомянутых в строке
function myPaths(src: string, prefix: string, userId: string, into: Set<string>) {
  let from = src.indexOf(prefix);
  while (from !== -1) {
    const start = from + prefix.length;
    const match = src.slice(start).match(/^[^"'\s)?#&<>]+/);
    if (match) {
      const path = decodeURIComponent(match[0]);
      if (path.startsWith(`${userId}/`)) into.add(path);
    }
    from = src.indexOf(prefix, start);
  }
}

async function collectKeptFiles(userId: string): Promise<Set<string>> {
  const kept = new Set<string>();
  const sources: string[] = [];

  // Все тетради групп, где я состою (свои и чужие) — со страницами
  const { data: groupNotebooks, error: nbError } = await supabase
    .from("notebooks")
    .select("id, cover_image_url, notes(content, attachments)")
    .not("group_id", "is", null);
  if (nbError) throw nbError;
  for (const nb of groupNotebooks ?? []) {
    if (nb.cover_image_url) sources.push(nb.cover_image_url);
    for (const page of (nb as any).notes ?? []) {
      sources.push(page.content ?? "", JSON.stringify(page.attachments ?? []));
    }
  }

  // Мои вложения в чатах групп — сообщения остаются, файлы тоже
  const { data: messages, error: msgError } = await supabase
    .from("group_messages")
    .select("attachment")
    .eq("author_id", userId)
    .not("attachment", "is", null);
  if (msgError) throw msgError;
  for (const m of messages ?? []) sources.push(JSON.stringify(m.attachment));

  for (const src of sources) {
    myPaths(src, SUPABASE_FILES, userId, kept);
    if (WORKER_FILES) myPaths(src, WORKER_FILES, userId, kept);
  }
  return kept;
}

async function purgeSupabaseStorage(userId: string, kept: Set<string>) {
  // Список по страницам; удаляем всё, кроме нужного группам
  for (let round = 0; round < 50; round++) {
    const { data, error } = await supabase.storage.from(BUCKET).list(userId, { limit: 1000, offset: 0 });
    if (error) throw error;
    const paths = (data ?? []).map((f) => `${userId}/${f.name}`).filter((p) => !kept.has(p));
    if (paths.length === 0) return;
    const { error: removeError } = await supabase.storage.from(BUCKET).remove(paths);
    if (removeError) throw removeError;
  }
}

async function purgeWorkerStorage(kept: Set<string>) {
  if (!WORKER) return;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Не авторизованы");
  let after: string | null = null;
  for (let round = 0; round < 50; round++) {
    const res = await fetch(`${WORKER}/account/purge`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ keep: [...kept], after }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `Хранилище файлов ответило ошибкой ${res.status}`);
    if (body.done) return;
    after = body.next;
  }
}

export async function deleteMyAccount(onStep: (step: DeletionStep) => void) {
  if (!navigator.onLine) throw new Error("Для удаления аккаунта нужен интернет");
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error("Не авторизованы — войдите заново и повторите");
  const userId = userData.user.id;

  onStep("collect");
  // Сначала убеждаемся, что сервер умеет удалять аккаунт — до того, как стирать файлы
  const { error: checkError } = await supabase.rpc("account_deletion_available");
  if (checkError) throw new Error("Удаление аккаунта ещё не включено на сервере — попробуйте позже или напишите в поддержку");
  const kept = await collectKeptFiles(userId);

  onStep("files");
  await purgeSupabaseStorage(userId, kept);
  await purgeWorkerStorage(kept);

  onStep("account");
  const { error } = await supabase.rpc("delete_my_account");
  if (error) throw error;

  onStep("done");
  await clearOfflineData();
  await signOut().catch(() => {});
}
