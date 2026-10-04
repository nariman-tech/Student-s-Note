import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  // Приложение всё равно откроется с моковыми данными — удобно на этапе разработки интерфейса,
  // пока не подключены реальные ключи Supabase (см. .env.example)
  console.warn(
    "Supabase не настроен: заполните .env по образцу .env.example, чтобы подключить реальные данные."
  );
}

export const supabase = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabaseAnonKey || "placeholder-anon-key"
);
