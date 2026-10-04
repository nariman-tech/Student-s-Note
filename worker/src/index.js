// Cloudflare Worker — посредник между приложением и хранилищем файлов Backblaze B2.
//
// Зачем он нужен: ключ доступа к B2 нельзя класть в приложение (его достанет любой).
// Worker хранит ключ у себя и делает три вещи:
//   POST   /upload   — принимает файл от вошедшего пользователя и кладёт его в ЕГО папку {userId}/…
//   GET    /f/<путь> — отдаёт файл для показа (имена файлов случайные — угадать ссылку нельзя)
//   DELETE /f/<путь> — удаляет файл, только если он лежит в папке того, кто просит
//
// Вход в аккаунт проверяем у самого Supabase: отдаём ему токен пользователя и получаем, кто это.

import { AwsClient } from "aws4fetch";

const MAX_BYTES = 20 * 1024 * 1024; // как и раньше в приложении — до 20 МБ на файл
const KEY_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{1,8}$/; // {userId}/{uuid}.{ext}

// Можно показывать прямо в браузере; всё остальное отдаём как скачивание — чтобы, например,
// загруженный HTML-файл не открылся как страница и не выполнил свой код
const INLINE_TYPES = /^(image\/(png|jpe?g|gif|webp|avif|bmp)|application\/pdf|video\/(mp4|webm)|audio\/(mpeg|ogg|wav))$/;

function b2(env) {
  return new AwsClient({
    accessKeyId: env.B2_KEY_ID,
    secretAccessKey: env.B2_APP_KEY,
    service: "s3",
    region: env.B2_REGION,
  });
}

const objectUrl = (env, key) => `${env.B2_ENDPOINT.replace(/\/$/, "")}/${env.B2_BUCKET}/${key}`;

function corsHeaders(request, env, anyOrigin = false) {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
  const allow = anyOrigin ? "*" : allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-File-Ext",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

// Кто прислал запрос: проверяем токен у Supabase (сеть, а не вычисления — бесплатный лимит CPU не тратится)
async function currentUserId(request, env) {
  const auth = request.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: auth },
  });
  if (!res.ok) return null;
  const user = await res.json();
  return typeof user?.id === "string" ? user.id : null;
}

async function handleUpload(request, env, cors) {
  const userId = await currentUserId(request, env);
  if (!userId) return json({ error: "Не авторизованы" }, 401, cors);

  const size = Number(request.headers.get("Content-Length") ?? "NaN");
  if (!Number.isFinite(size)) return json({ error: "Не указан размер файла" }, 411, cors);
  if (size > MAX_BYTES) return json({ error: "Файл больше 20 МБ — выберите файл поменьше" }, 413, cors);

  const ext = (request.headers.get("X-File-Ext") ?? "bin").toLowerCase();
  if (!/^[a-z0-9]{1,8}$/.test(ext)) return json({ error: "Недопустимое расширение файла" }, 400, cors);
  const contentType = (request.headers.get("Content-Type") ?? "application/octet-stream").slice(0, 100);

  const key = `${userId}/${crypto.randomUUID()}.${ext}`;
  // UNSIGNED-PAYLOAD — не считаем хэш файла: файл просто «протекает» через Worker в B2,
  // не упираясь в бесплатный лимит процессорного времени
  const res = await b2(env).fetch(objectUrl(env, key), {
    method: "PUT",
    body: request.body,
    headers: { "Content-Type": contentType, "Content-Length": String(size), "X-Amz-Content-Sha256": "UNSIGNED-PAYLOAD" },
  });
  if (!res.ok) {
    console.log("B2 upload failed", res.status, await res.text());
    return json({ error: "Хранилище не приняло файл. Попробуйте ещё раз" }, 502, cors);
  }
  const base = new URL(request.url).origin;
  return json({ url: `${base}/f/${key}` }, 200, cors);
}

async function handleGet(request, env, key) {
  const cors = corsHeaders(request, env, true); // картинки читает и рисование (html2canvas) — нужен CORS
  const range = request.headers.get("Range");
  const res = await b2(env).fetch(objectUrl(env, key), { method: "GET", headers: range ? { Range: range } : {} });
  if (res.status === 404) return new Response("Файл не найден", { status: 404, headers: cors });
  if (!res.ok && res.status !== 206) return new Response("Хранилище недоступно", { status: 502, headers: cors });

  const type = res.headers.get("Content-Type") ?? "application/octet-stream";
  const headers = new Headers(cors);
  headers.set("Content-Type", type);
  headers.set("Cache-Control", "public, max-age=31536000, immutable"); // имя файла уникально — его содержимое не меняется
  headers.set("X-Content-Type-Options", "nosniff");
  for (const h of ["Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified"]) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (!INLINE_TYPES.test(type)) {
    headers.set("Content-Disposition", "attachment");
    headers.set("Content-Security-Policy", "sandbox");
  }
  return new Response(res.body, { status: res.status, headers });
}

async function handleDelete(request, env, key, cors) {
  const userId = await currentUserId(request, env);
  if (!userId) return json({ error: "Не авторизованы" }, 401, cors);
  if (!key.startsWith(`${userId}/`)) return json({ error: "Можно удалять только свои файлы" }, 403, cors);
  const res = await b2(env).fetch(objectUrl(env, key), { method: "DELETE" });
  if (!res.ok && res.status !== 404) return json({ error: "Не получилось удалить файл" }, 502, cors);
  return new Response(null, { status: 204, headers: cors });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    try {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      if (url.pathname === "/upload" && request.method === "POST") return await handleUpload(request, env, cors);
      if (url.pathname.startsWith("/f/")) {
        const key = decodeURIComponent(url.pathname.slice(3));
        if (!KEY_RE.test(key)) return new Response("Не найдено", { status: 404, headers: cors });
        if (request.method === "GET" || request.method === "HEAD") return await handleGet(request, env, key);
        if (request.method === "DELETE") return await handleDelete(request, env, key, cors);
      }
      return new Response("Не найдено", { status: 404, headers: cors });
    } catch (err) {
      console.log("Worker error", err?.stack ?? String(err));
      return json({ error: "Ошибка сервера файлов" }, 500, cors);
    }
  },
};
