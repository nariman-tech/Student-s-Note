// Загрузка файлов. Два хранилища:
//  • Backblaze B2 через Cloudflare Worker (папка worker/) — если задан VITE_FILES_WORKER_URL.
//    10 ГБ бесплатно; все новые файлы идут туда.
//  • Supabase Storage (бакет "uploads", см. supabase/storage.sql) — если Worker не настроен, и для файлов,
//    загруженных раньше: старые ссылки продолжают работать.
// В базу пишется только ссылка на файл. Файлы лежат по пути {userId}/{случайный uuid}.{расширение}:
// загружать и удалять можно только в свою папку, а открыть файл можно только зная ссылку.

import { supabase } from "./supabase";

const BUCKET = "uploads";
const SUPABASE_FILES = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;
// Адрес Worker для Backblaze B2 (без «/» в конце) или пусто — тогда всё в Supabase Storage
const WORKER = (import.meta.env.VITE_FILES_WORKER_URL ?? "").replace(/\/$/, "");
const WORKER_FILES = WORKER ? `${WORKER}/f/` : null;
const MAX_FILE_BYTES = 20 * 1024 * 1024; // совпадает с file_size_limit бакета

// Сжатие фото: 1280px по длинной стороне и качество WebP 0.8 — на экране разницы с оригиналом почти нет,
// а место в бесплатном хранилище (1 ГБ) и трафик тратятся в 1.5–2 раза меньше
const PHOTO_MAX_SIDE = 1280;
const PHOTO_QUALITY = 0.8;

async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Не авторизованы");
  return data.user.id;
}

function extFromMime(mime: string): string {
  const known: Record<string, string> = {
    "image/webp": "webp",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "application/pdf": "pdf",
  };
  return known[mime] ?? mime.split("/")[1]?.replace(/[^a-z0-9]/gi, "") ?? "bin";
}

async function uploadBlob(blob: Blob, contentType: string): Promise<string> {
  if (blob.size > MAX_FILE_BYTES) throw new Error("Файл больше 20 МБ — выберите файл поменьше");
  if (WORKER) return uploadViaWorker(blob, contentType);
  const userId = await currentUserId();
  const path = `${userId}/${crypto.randomUUID()}.${extFromMime(contentType)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType, cacheControl: "31536000" });
  if (error) throw new Error(`Не получилось загрузить файл: ${error.message}`);
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Не авторизованы");
  return data.session.access_token;
}

// Файл уходит в Worker, тот проверяет вход в аккаунт и кладёт файл в B2 в папку пользователя
async function uploadViaWorker(blob: Blob, contentType: string): Promise<string> {
  const res = await fetch(`${WORKER}/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": contentType,
      "X-File-Ext": extFromMime(contentType),
    },
    body: blob,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || typeof data.url !== "string") {
    throw new Error(`Не получилось загрузить файл: ${data.error ?? res.status}`);
  }
  return data.url;
}

async function deleteViaWorker(fileUrl: string) {
  const res = await fetch(fileUrl, { method: "DELETE", headers: { Authorization: `Bearer ${await accessToken()}` } });
  if (!res.ok && res.status !== 404) console.warn("Файл не удалён из хранилища B2", res.status);
}

// Уменьшаем картинку до maxSide по длинной стороне и пережимаем в WebP — фото с телефона
// весом 4–8 МБ превращается в ~100–250 КБ без заметной потери качества.
// GIF не трогаем (анимация пропала бы), SVG тоже (он и так маленький и векторный).
async function compressImage(source: Blob, maxSide: number): Promise<Blob> {
  if (source.type === "image/gif" || source.type === "image/svg+xml") return source;
  const bitmap = await createImageBitmap(source);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", PHOTO_QUALITY));
  // Если сжатие не помогло (маленькая картинка) — грузим оригинал
  return blob && blob.size < source.size ? blob : source;
}

export async function uploadImage(file: Blob, maxSide = PHOTO_MAX_SIDE): Promise<string> {
  const blob = await compressImage(file, maxSide);
  return uploadBlob(blob, blob.type || "image/png");
}

export async function uploadFile(file: File): Promise<string> {
  return uploadBlob(file, file.type || "application/octet-stream");
}

// Для скриншотов из режима рисования — html2canvas отдаёт canvas
export async function uploadCanvas(canvas: HTMLCanvasElement): Promise<string> {
  // Рисунок поверх конспекта — тонкие линии и текст, поэтому качество чуть выше, чем у фото
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
  if (!blob) throw new Error("Не получилось сохранить рисунок");
  return uploadBlob(blob, blob.type);
}

// Все ссылки на наши файлы внутри строки (URL обложки, HTML конспекта, URL вложения) — путь {userId}/{файл}
function findFilePaths(src: string, prefix: string): string[] {
  const found: string[] = [];
  let from = src.indexOf(prefix);
  while (from !== -1) {
    const start = from + prefix.length;
    const match = src.slice(start).match(/^[^"'\s)?#&<>]+/);
    if (match) found.push(decodeURIComponent(match[0]));
    from = src.indexOf(prefix, start);
  }
  return found;
}

// Удаляет из хранилищ файлы, на которые ссылаются переданные строки. Ссылки не на наши хранилища
// (например, старые base64-картинки) пропускаются. Ошибки не пробрасываем: если файл не удалился,
// это мусор в хранилище, а не повод показывать пользователю ошибку после того, как тетрадь уже удалена.
export async function removeUploadedFiles(sources: (string | undefined)[]) {
  const supabasePaths = new Set<string>();
  const workerPaths = new Set<string>();
  for (const src of sources) {
    if (!src) continue;
    findFilePaths(src, SUPABASE_FILES).forEach((p) => supabasePaths.add(p));
    if (WORKER_FILES) findFilePaths(src, WORKER_FILES).forEach((p) => workerPaths.add(p));
  }
  if (supabasePaths.size > 0) {
    const { error } = await supabase.storage.from(BUCKET).remove([...supabasePaths]);
    if (error) console.warn("Не удалось удалить файлы из хранилища", error);
  }
  await Promise.all([...workerPaths].map((p) => deleteViaWorker(`${WORKER_FILES}${p}`).catch(() => {})));
}

// Ссылка ведёт в наше хранилище? Сообщения чата можно записать и в обход приложения —
// показываем вложение, только если это действительно файл из Storage, а не javascript:… или чужой сайт
export function isUploadedFileUrl(url: unknown): url is string {
  return typeof url === "string" && (url.startsWith(SUPABASE_FILES) || (!!WORKER_FILES && url.startsWith(WORKER_FILES)));
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

// Фото или файл для чата группы: фото сжимаются так же, как в конспектах, файлы грузятся как есть.
// GIF и SVG считаем файлами — сжимать их нельзя, а SVG ещё и может содержать скрипты
export async function uploadChatAttachment(file: File): Promise<{ url: string; name: string; type: "image" | "file"; size: number }> {
  const isPhoto = /^image\/(jpeg|png|webp|bmp|avif)$/.test(file.type);
  if (isPhoto) {
    // Если браузер не смог прочитать картинку (битый файл) — отправим её как обычный файл
    const blob = await compressImage(file, PHOTO_MAX_SIDE).catch(() => null);
    if (blob) {
      const url = await uploadBlob(blob, blob.type || file.type);
      return { url, name: file.name, type: "image", size: blob.size };
    }
  }
  const url = await uploadFile(file);
  return { url, name: file.name, type: "file", size: file.size };
}

// Картинку/файл убрали из конспекта крестиком — удаляем файл из хранилища, но только если он
// больше нигде не используется (его могли скопировать на другую страницу или в другую тетрадь).
// Проверяем среди того, что видно этому пользователю; чужие файлы (в тетради группы) хранилище
// удалить всё равно не даст — это не ошибка, файл просто остаётся.
export async function removeFileIfUnused(url: string) {
  if (!isUploadedFileUrl(url)) return;
  const inWorker = !!WORKER_FILES && url.startsWith(WORKER_FILES);
  const path = url.slice((inWorker ? WORKER_FILES! : SUPABASE_FILES).length);
  if (!/^[A-Za-z0-9/_.-]+$/.test(path)) return; // путь — всегда {uuid}/{uuid}.{ext}; иное не трогаем

  const [inContent, inAttachments, asCover] = await Promise.all([
    supabase.from("notes").select("id", { count: "exact", head: true }).ilike("content", `%${path}%`),
    supabase.from("notes").select("id", { count: "exact", head: true }).contains("attachments", JSON.stringify([{ url }])), // jsonb @> — только в виде JSON-строки
    supabase.from("notebooks").select("id", { count: "exact", head: true }).eq("cover_image_url", url),
  ]);
  if (inContent.error || inAttachments.error || asCover.error) return; // не смогли проверить — не рискуем
  if ((inContent.count ?? 0) + (inAttachments.count ?? 0) + (asCover.count ?? 0) > 0) return;

  if (inWorker) {
    await deleteViaWorker(url);
    return;
  }
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) console.warn("Файл не удалён из хранилища", error.message);
}
