import { createClient } from "@supabase/supabase-js";
import { OfflineError } from "./offline";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  // Приложение всё равно откроется с моковыми данными — удобно на этапе разработки интерфейса,
  // пока не подключены реальные ключи Supabase (см. .env.example)
  console.warn(
    "Supabase не настроен: заполните .env по образцу .env.example, чтобы подключить реальные данные."
  );
}

// Без интернета запросы даже не отправляем: сразу понятная ошибка «нет подключения» вместо
// «Failed to fetch» (данные для чтения в это время берутся из офлайн-кэша, см. lib/offline.ts)
const offlineAwareFetch: typeof fetch = (input, init) =>
  typeof navigator !== "undefined" && navigator.onLine === false ? Promise.reject(new OfflineError()) : fetch(input, init);

export const supabase = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabaseAnonKey || "placeholder-anon-key",
  { global: { fetch: offlineAwareFetch } }
);
