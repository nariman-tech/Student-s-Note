// Service worker Lectiva: установка приложения и работа без интернета.
//
// Что кэшируем:
//  • Файлы приложения (/assets/*). При установке скачиваем сразу все по списку /precache.json
//    (его создаёт сборка, см. vite.config.ts) — без интернета открываются все разделы.
//  • Страницу index.html — из сети, а из кэша только без интернета, чтобы после публикации
//    новой версии все сразу получали её.
//  • Картинки и файлы из конспектов (Supabase Storage и Backblaze через Worker) — у них случайные
//    неизменяемые имена, поэтому кэш на устройстве всегда верный. Отдельный кэш "lectiva-files"
//    стирается при выходе из аккаунта.
//  • Шрифты Google — чтобы без сети приложение выглядело так же.
// Данные (запросы к базе Supabase) сюда не попадают — их офлайн-копию хранит приложение (src/lib/offline.ts).

const CACHE = "lectiva-v2"; // новое имя — старый кэш удалится при обновлении
const FILES = "lectiva-files";
const FONTS = "lectiva-fonts";
const MAX_FILES = 400; // картинок из конспектов храним не больше — самые старые вытесняются

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const list = await fetch("/precache.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : []));
        await cache.addAll(["/", ...list]);
      } catch {
        // Нет сети или списка (разработка) — ничего страшного, файлы закэшируются по мере открытия
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  // Удаляем кэши прошлых версий; кэш файлов и шрифтов сохраняем
  const keep = [CACHE, FILES, FONTS];
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Сначала кэш, иначе сеть (и запомнить).
// Чужие адреса (файлы, шрифты) запрашиваем сами в режиме CORS: <img> просит их без CORS и получил бы
// «непрозрачный» ответ — такой нельзя потом отдать рисованию (html2canvas), которое просит с CORS.
// Ответ с CORS подходит обоим, и хранилища его разрешают
function cacheFirst(event, cacheName, limit) {
  const request = event.request;
  const sameOrigin = new URL(request.url).origin === self.location.origin;
  event.respondWith(
    caches.open(cacheName).then((cache) =>
      cache.match(request.url).then(
        (cached) =>
          cached ??
          fetch(sameOrigin ? request : new Request(request.url, { mode: "cors", credentials: "omit" }))
            .then((res) => {
              if (res.ok) cache.put(request.url, res.clone()).then(() => limit && trim(cache, limit));
              return res;
            })
            .catch((err) => (sameOrigin ? Promise.reject(err) : fetch(request)))
      )
    )
  );
}

async function trim(cache, limit) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - limit; i++) await cache.delete(keys[i]);
}

// Пользовательский файл: Supabase Storage (public bucket) или Worker с путём /f/{userId}/{uuid}.{ext}
function isUserFile(url) {
  return (
    url.pathname.includes("/storage/v1/object/public/uploads/") ||
    /^\/f\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{1,8}$/.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.headers.has("range")) return; // видео с перемоткой — мимо кэша
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    if (isUserFile(url)) return cacheFirst(event, FILES, MAX_FILES);
    if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") return cacheFirst(event, FONTS);
    return; // база Supabase и всё остальное — напрямую
  }

  // Файлы приложения
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) return cacheFirst(event, CACHE);

  // Страницы приложения: сначала сеть (свежая версия), без интернета — последняя сохранённая
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("/", copy));
          }
          return res;
        })
        .catch(() => caches.match("/").then((cached) => cached ?? Response.error()))
    );
  }
});
