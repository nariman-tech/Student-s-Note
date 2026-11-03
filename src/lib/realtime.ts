// «Живые» обновления (чат, закрепление, правки общих тетрадей) — через Supabase Broadcast.
//
// База сама рассылает события в «комнаты» (migration_018): group:<id> и page:<id>. Права на комнату
// проверяются один раз при подключении, а не на каждое сообщение — так выдерживаются тысячи онлайн.
//
// Здесь:
//  • одна подписка на комнату на всё приложение (чат группы и счётчик непрочитанных слушают одну и ту же);
//  • свёрнутая больше минуты вкладка отключается от «живых» обновлений — не занимает подключение
//    к серверу (их число ограничено тарифом). Вернулись — подключаемся и дозагружаем пропущенное
//    (событие REALTIME_RESUMED);
//  • если миграция 018 ещё не выполнена — работаем по-старому (Postgres Changes), см. realtimeMode.

import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export const REALTIME_RESUMED = "lectiva-realtime-resumed";

// События, которые присылает база (см. триггеры в migration_018)
const EVENTS = ["message_insert", "message_delete", "pin", "page_update"] as const;
export type TopicEvent = (typeof EVENTS)[number];
type Handler = (event: TopicEvent, payload: any) => void;

let modePromise: Promise<"broadcast" | "changes"> | null = null;

export function realtimeMode(): Promise<"broadcast" | "changes"> {
  if (!modePromise) {
    modePromise = Promise.resolve(supabase.rpc("realtime_broadcast_enabled"))
      .then(({ error }) => (error ? "changes" : "broadcast"))
      .catch(() => "changes" as const);
    // Ошибка сети при первой проверке — не запоминаем, спросим ещё раз позже
    modePromise.then((m) => {
      if (m === "changes" && !navigator.onLine) modePromise = null;
    });
  }
  return modePromise;
}

interface TopicEntry {
  channel: RealtimeChannel | null; // null — канал ещё открывается
  handlers: Set<Handler>;
  closeTimer?: number;
}
const topics = new Map<string, TopicEntry>();

// payload от realtime.send приходит как есть; на случай другой обёртки берём .record/.payload
function unwrap(msg: any): any {
  const p = msg?.payload ?? msg;
  return p?.record ?? p?.payload ?? p;
}

// Канал с тем же именем нельзя создать заново, пока старый не закрылся до конца
// (supabase.channel вернул бы старый, уже подписанный) — поэтому сначала дожидаемся закрытия
async function openChannel(topic: string, entry: TopicEntry) {
  const stale = supabase.getChannels().filter((c) => c.topic === `realtime:${topic}`);
  await Promise.all(stale.map((c) => supabase.removeChannel(c)));
  if (topics.get(topic) !== entry) return; // пока закрывали старый, подписка уже не нужна
  const channel = supabase.channel(topic, { config: { private: true } });
  for (const event of EVENTS) {
    channel.on("broadcast", { event }, (msg) => entry.handlers.forEach((h) => h(event, unwrap(msg))));
  }
  entry.channel = channel;
  // Токен входа нужен для проверки прав на комнату
  await Promise.resolve(supabase.realtime.setAuth()).catch(() => {});
  channel.subscribe();
}

export function subscribeTopic(topic: string, handler: Handler): () => void {
  let entry = topics.get(topic);
  if (!entry) {
    entry = { channel: null, handlers: new Set() };
    topics.set(topic, entry);
    void openChannel(topic, entry);
  }
  window.clearTimeout(entry.closeTimer);
  entry.handlers.add(handler);
  const current = entry;
  return () => {
    current.handlers.delete(handler);
    if (current.handlers.size > 0) return;
    // Закрываем не сразу: при переходе между страницами подписка обычно тут же нужна снова
    current.closeTimer = window.setTimeout(() => {
      if (current.handlers.size > 0 || topics.get(topic) !== current) return;
      topics.delete(topic);
      if (current.channel) void supabase.removeChannel(current.channel);
    }, 3000);
  };
}

// --- Свёрнутая вкладка не держит подключение ---

const PAUSE_AFTER_MS = 60_000;
let pauseTimer: number | undefined;
let paused = false;

function resume() {
  if (!paused) return;
  paused = false;
  supabase.realtime.connect();
  // Переподписываемся заново: старые каналы закрылись вместе с соединением
  for (const [topic, entry] of topics) {
    entry.channel = null;
    void openChannel(topic, entry);
  }
  window.dispatchEvent(new Event(REALTIME_RESUMED));
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    window.clearTimeout(pauseTimer);
    if (document.visibilityState === "hidden") {
      pauseTimer = window.setTimeout(async () => {
        if ((await realtimeMode()) !== "broadcast" || document.visibilityState !== "hidden") return;
        paused = true;
        supabase.realtime.disconnect();
      }, PAUSE_AFTER_MS);
    } else {
      resume();
    }
  });
}
