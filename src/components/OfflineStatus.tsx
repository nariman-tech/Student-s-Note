import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { useOnline, usePendingCount } from "../lib/offline";

// Значок «Без сети» в боковой панели (и компактный — в верхней полосе на телефоне).
// Показывает и сколько правок ждут отправки
export function OfflineBadge({ compact = false }: { compact?: boolean }) {
  const online = useOnline();
  const pending = usePendingCount();
  if (online && pending === 0) return null;

  const text = online ? `Отправляем правки: ${pending}` : pending > 0 ? `Без сети, не отправлено: ${pending}` : "Без сети";
  if (compact) {
    return (
      <span
        className="flex items-center gap-1.5 rounded-full bg-highlight text-ink text-[11px] font-semibold px-2.5 py-1"
        title={text}
      >
        <Icon name={online ? "cloud" : "offline"} size={14} />
        {online ? pending : "Офлайн"}
      </span>
    );
  }
  return (
    <div className="mb-2 flex items-start gap-2.5 rounded-card bg-highlight/15 text-highlight px-3 py-2.5 text-xs leading-snug">
      <Icon name={online ? "cloud" : "offline"} size={16} className="shrink-0 mt-px" />
      <span>
        <span className="font-semibold block">{text}</span>
        {!online && <span className="text-white/60">Конспекты открываются из сохранённых, правки отправятся сами</span>}
      </span>
    </div>
  );
}

// Короткое уведомление внизу экрана, когда сеть пропала или вернулась
export function SyncToast() {
  const online = useOnline();
  const [message, setMessage] = useState<string | null>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      if (online) return;
    }
    setMessage(online ? "Интернет вернулся — сохраняем правки" : "Нет интернета — работаем офлайн");
    const t = window.setTimeout(() => setMessage(null), 3500);
    return () => window.clearTimeout(t);
  }, [online]);

  if (!message) return null;
  return (
    <div
      role="status"
      className="fixed left-1/2 -translate-x-1/2 bottom-24 md:bottom-6 z-50 flex items-center gap-2 rounded-full bg-ink text-white text-sm px-4 py-2.5 shadow-pop print:hidden"
      style={{ animation: "dialog-in 200ms ease-out" }}
    >
      <Icon name={online ? "cloud" : "offline"} size={16} className="text-highlight" />
      {message}
    </div>
  );
}
