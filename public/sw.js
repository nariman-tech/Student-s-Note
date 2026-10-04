// Service worker «Тетради»: приложение можно установить, и оно быстро открывается.
//
// Что кэшируем: только файлы самого приложения (/assets/* — у них уникальные имена,
// содержимое не меняется). Страницу index.html берём из сети, а из кэша — только без интернета,
// чтобы после публикации новой версии все сразу получили её.
// Данные (Supabase) и файлы пользователей (Backblaze) не трогаем вовсе — они всегда из сети.

const CACHE = "tetrad-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  // Удаляем кэши прошлых версий service worker
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Supabase, Backblaze, шрифты — мимо кэша

  // Файлы приложения: сначала кэш, иначе сеть (и запомнить)
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(request, copy));
            }
            return res;
          })
      )
    );
    return;
  }

  // Страницы приложения: сначала сеть (свежая версия), без интернета — последняя сохранённая
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/").then((cached) => cached ?? Response.error()))
    );
  }
});
