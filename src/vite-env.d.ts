/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_FILES_WORKER_URL?: string; // Cloudflare Worker для Backblaze B2 (worker/); пусто — файлы в Supabase
  readonly VITE_PUBLIC_APP_URL?: string; // адрес опубликованного приложения — для ссылок в мессенджеры
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
