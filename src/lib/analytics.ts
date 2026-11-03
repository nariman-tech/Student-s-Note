// Аналитика и отзывы. Считаем только числа: кто был активен в какой день и сколько раз пользовались
// функциями (функция track в базе, migration_014) — содержимое конспектов и сообщений не отправляется.

import { supabase } from "./supabase";

export type TrackedEvent =
  | "app_open"
  | "pdf_export"
  | "card_from_selection"
  | "search"
  | "share_link_enabled"
  | "group_notebook_created"
  | "drawing_attached"
  | "feedback_sent";

// «Выстрелил и забыл»: аналитика никогда не должна ломать или тормозить само приложение
export function track(event: TrackedEvent) {
  supabase.rpc("track", { event_name: event }).then(({ error }) => {
    if (error) console.warn("Аналитика:", error.message);
  });
}

// Поиск вызывается на каждую букву — считаем один поиск на 5 секунд, а не каждую букву
let lastSearchTrack = 0;
export function trackSearch() {
  const now = Date.now();
  if (now - lastSearchTrack > 5000) {
    lastSearchTrack = now;
    track("search");
  }
}

export async function isAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_admin");
  if (error) return false;
  return data === true;
}

// --- Отзывы ---

export type FeedbackCategory = "like" | "bug" | "idea" | "other";

export interface FeedbackItem {
  id: string;
  userId?: string;
  username?: string;
  rating?: number;
  category: FeedbackCategory;
  message: string;
  page?: string;
  userAgent?: string;
  status: "new" | "done";
  createdAt: string;
}

export async function sendFeedback(input: { rating?: number; category: FeedbackCategory; message: string }) {
  // id — из сохранённой сессии: запрос getUser к серверу лишний и иногда падает (истёкший токен,
  // медленная сеть), и тогда отзыв не уходил
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) throw new Error("Войдите в аккаунт заново и повторите");
  const { error } = await supabase.from("feedback").insert({
    user_id: userId,
    rating: input.rating ?? null,
    category: input.category,
    message: input.message.trim(),
    page: window.location.pathname.slice(0, 200),
    user_agent: navigator.userAgent.slice(0, 300),
  });
  if (error) {
    console.error("Отзыв не отправлен", error);
    throw new Error(
      error.code === "42P01" || /relation .*feedback/i.test(error.message)
        ? "Отзывы ещё не включены на сервере"
        : `Не получилось отправить отзыв: ${error.message}`
    );
  }
  track("feedback_sent");
}

// Для администратора (правила доступа отдадут все отзывы только ему)
export async function getAllFeedback(): Promise<FeedbackItem[]> {
  const { data, error } = await supabase
    .from("feedback")
    .select("*, public_profiles(username)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    userId: r.user_id ?? undefined,
    username: r.public_profiles?.username ?? undefined,
    rating: r.rating ?? undefined,
    category: r.category,
    message: r.message ?? "",
    page: r.page ?? undefined,
    userAgent: r.user_agent ?? undefined,
    status: r.status,
    createdAt: r.created_at,
  }));
}

export async function deleteFeedback(id: string) {
  const { error } = await supabase.from("feedback").delete().eq("id", id);
  if (error) throw error;
}

export async function setFeedbackStatus(id: string, status: "new" | "done") {
  const { error } = await supabase.from("feedback").update({ status }).eq("id", id);
  if (error) throw error;
}

// --- Сводка для страницы «Аналитика» ---

export interface AdminStats {
  totals: Record<
    | "users"
    | "notebooks"
    | "group_notebooks"
    | "pages"
    | "flashcard_sets"
    | "flashcards"
    | "groups"
    | "messages"
    | "friendships"
    | "feedback"
    | "feedback_new",
    number
  > & { avg_rating: number | null };
  active: { today: number; week: number; month: number };
  daily: { day: string; active: number; new_users: number; notebooks: number; pages: number; messages: number }[];
  events: Partial<Record<TrackedEvent, number>>;
}

export async function getAdminStats(days = 30): Promise<AdminStats> {
  const { data, error } = await supabase.rpc("admin_stats", { days });
  if (error) throw error;
  return data as AdminStats;
}
