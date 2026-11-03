// Непрочитанные сообщения в группах.
//
// Сервер считает, сколько чужих сообщений пришло в каждой группе с тех пор, как вы последний раз
// открывали её чат (my_unread_counts, migration_017). Здесь — один общий счётчик на всё приложение:
//  • обновляется сразу при новом сообщении (Supabase Realtime), раз в минуту и при возвращении в окно;
//  • показывается значком у «Группы» в меню, у каждой группы в списке,
//    числом на иконке установленного приложения и в заголовке окна: «(3) Lectiva».

import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { isOnline } from "./offline";

export interface UnreadState {
  byGroup: Record<string, number>;
  readAt: Record<string, string>; // когда последний раз открывали чат группы
  total: number;
}

let state: UnreadState = { byGroup: {}, readAt: {}, total: 0 };
const listeners = new Set<(s: UnreadState) => void>();
let openGroupId: string | null = null; // чат, открытый на экране прямо сейчас, — в нём ничего не «пропущено»
let stop: (() => void) | null = null;
let refreshTimer: number | undefined;
let available = true; // false — миграция 017 не выполнена: счётчик молча не работает

function publish(next: UnreadState) {
  state = next;
  listeners.forEach((l) => l(state));
  updateBadges(state.total);
}

export async function refreshUnread(): Promise<UnreadState> {
  if (!available || !isOnline()) return state;
  const { data, error } = await supabase.rpc("my_unread_counts");
  if (error) {
    if (error.code === "PGRST202") available = false;
    return state;
  }
  const byGroup: Record<string, number> = {};
  const readAt: Record<string, string> = {};
  for (const r of (data ?? []) as { gid: string; unread: number; read_at: string | null }[]) {
    byGroup[r.gid] = r.gid === openGroupId ? 0 : Number(r.unread) || 0;
    if (r.read_at) readAt[r.gid] = r.read_at;
  }
  publish({ byGroup, readAt, total: Object.values(byGroup).reduce((a, b) => a + b, 0) });
  return state;
}

// Несколько событий подряд (пачка сообщений) — один запрос
function refreshSoon() {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => void refreshUnread(), 400);
}

// Чат группы открыт и виден — отмечаем прочитанным на сервере и обнуляем счётчик сразу
export async function markGroupRead(groupId: string) {
  if (state.byGroup[groupId]) {
    const total = state.total - state.byGroup[groupId];
    publish({ ...state, byGroup: { ...state.byGroup, [groupId]: 0 }, total });
  }
  if (!available || !isOnline()) return;
  const { error } = await supabase.rpc("mark_group_read", { gid: groupId });
  if (error?.code === "PGRST202") available = false;
}

export function setOpenGroup(groupId: string | null) {
  openGroupId = groupId;
}

function start() {
  void refreshUnread();
  // Новое сообщение в любой моей группе. Фильтр по группе не нужен: правила доступа
  // в базе действуют и здесь — придут только сообщения групп, где я участник
  const channel = supabase
    .channel(`unread-${crypto.randomUUID()}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "group_messages" }, refreshSoon)
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "group_messages" }, refreshSoon)
    .subscribe();
  const timer = window.setInterval(() => void refreshUnread(), 60_000);
  const onFocus = () => void refreshUnread();
  window.addEventListener("focus", onFocus);
  window.addEventListener("online", onFocus);
  return () => {
    supabase.removeChannel(channel);
    window.clearInterval(timer);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("online", onFocus);
  };
}

export function useUnread(): UnreadState {
  const [s, setS] = useState(state);
  useEffect(() => {
    listeners.add(setS);
    if (!stop) stop = start();
    setS(state);
    return () => {
      listeners.delete(setS);
      if (listeners.size === 0 && stop) {
        stop();
        stop = null;
      }
    };
  }, []);
  return s;
}

// Число на иконке приложения (Windows, Android, macOS — где браузер это умеет) и в заголовке окна
function updateBadges(total: number) {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    if (total > 0) nav.setAppBadge?.(total)?.catch(() => {});
    else nav.clearAppBadge?.()?.catch(() => {});
  } catch {}
  const base = document.title.replace(/^\(\d+\+?\)\s*/, "");
  document.title = total > 0 ? `(${total > 99 ? "99+" : total}) ${base}` : base;
}

export function resetUnread() {
  publish({ byGroup: {}, readAt: {}, total: 0 });
}
