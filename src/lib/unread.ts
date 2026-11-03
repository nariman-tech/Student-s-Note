// Непрочитанные сообщения в группах.
//
// Сервер считает, сколько чужих сообщений пришло в каждой группе с тех пор, как вы последний раз
// открывали её чат (my_unread_counts, migration_017). Здесь — один общий счётчик на всё приложение:
//  • точные числа берём у сервера при запуске, раз в 5 минут и при возвращении в окно;
//  • между этим новое сообщение просто прибавляет 1 у себя — без запроса к базе (комнаты group:<id>,
//    migration_018). Без migration_018 — по-старому: любое сообщение → запрос к серверу;
//  • показывается значком у «Группы» в меню, у каждой группы в списке,
//    числом на иконке установленного приложения и в заголовке окна: «(3) Lectiva».

import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { isOnline } from "./offline";
import { realtimeMode, subscribeTopic, REALTIME_RESUMED } from "./realtime";

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

let myId = "";
const groupSubs = new Map<string, () => void>(); // комнаты моих групп, которые слушаем

// Новое сообщение в группе: +1, если оно чужое и этот чат сейчас не открыт
function onGroupEvent(groupId: string, event: string, payload: any) {
  if (event === "message_delete") return refreshSoon();
  if (event !== "message_insert") return;
  if (!payload?.author_id || payload.author_id === myId || groupId === openGroupId) return;
  const n = (state.byGroup[groupId] ?? 0) + 1;
  publish({ ...state, byGroup: { ...state.byGroup, [groupId]: n }, total: state.total + 1 });
}

// Слушаем ровно свои группы: вступили — подписались, вышли — отписались
function syncGroupSubscriptions() {
  const mine = new Set(Object.keys(state.byGroup));
  for (const [gid, unsub] of groupSubs) {
    if (!mine.has(gid)) {
      unsub();
      groupSubs.delete(gid);
    }
  }
  for (const gid of mine) {
    if (!groupSubs.has(gid)) groupSubs.set(gid, subscribeTopic(`group:${gid}`, (ev, p) => onGroupEvent(gid, ev, p)));
  }
}

function start() {
  let stopRealtime = () => {};
  let stopped = false;

  void supabase.auth.getSession().then(({ data }) => (myId = data.session?.user.id ?? ""));
  void realtimeMode().then(async (mode) => {
    await refreshUnread();
    if (stopped) return;
    if (mode === "broadcast") {
      syncGroupSubscriptions();
      listeners.add(syncOnChange);
      stopRealtime = () => {
        listeners.delete(syncOnChange);
        groupSubs.forEach((unsub) => unsub());
        groupSubs.clear();
      };
      return;
    }
    // Старый способ (без migration_018): любое сообщение в моих группах → пересчитать на сервере
    const channel = supabase
      .channel(`unread-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "group_messages" }, refreshSoon)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "group_messages" }, refreshSoon)
      .subscribe();
    stopRealtime = () => void supabase.removeChannel(channel);
  });

  // Сверяемся с сервером раз в 5 минут — только пока окно на экране
  const timer = window.setInterval(() => {
    if (document.visibilityState === "visible") void refreshUnread();
  }, 5 * 60_000);
  const onFocus = () => void refreshUnread();
  window.addEventListener("focus", onFocus);
  window.addEventListener("online", onFocus);
  window.addEventListener(REALTIME_RESUMED, onFocus);
  return () => {
    stopped = true;
    stopRealtime();
    window.clearInterval(timer);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("online", onFocus);
    window.removeEventListener(REALTIME_RESUMED, onFocus);
  };
}

// Список групп пришёл с сервера — подписки подтягиваем под него
let lastGroupKey = "";
function syncOnChange(s: UnreadState) {
  const key = Object.keys(s.byGroup).sort().join(",");
  if (key === lastGroupKey) return;
  lastGroupKey = key;
  syncGroupSubscriptions();
}

let hookCount = 0; // сколько значков сейчас на экране

export function useUnread(): UnreadState {
  const [s, setS] = useState(state);
  useEffect(() => {
    listeners.add(setS);
    hookCount++;
    if (!stop) stop = start();
    setS(state);
    return () => {
      listeners.delete(setS);
      hookCount--;
      // Последний значок на экране пропал (вышли из аккаунта) — отключаемся
      if (hookCount === 0 && stop) {
        stop();
        stop = null;
        lastGroupKey = "";
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
