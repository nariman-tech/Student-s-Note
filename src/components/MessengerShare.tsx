import { useState } from "react";
import { isLocalAppUrl } from "../lib/links";

// Кнопки «отправить ссылку» в популярные мессенджеры + копирование.
// Мессенджеры открываются в браузере/приложении со вставленным текстом — остаётся выбрать, кому отправить.
export default function MessengerShare({ url, text }: { url: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const message = `${text}\n${url}`;

  const targets = [
    { name: "Telegram", icon: "✈️", href: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}` },
    { name: "WhatsApp", icon: "💬", href: `https://wa.me/?text=${encodeURIComponent(message)}` },
    { name: "ВКонтакте", icon: "🔵", href: `https://vk.com/share.php?url=${encodeURIComponent(url)}&title=${encodeURIComponent(text)}` },
    { name: "Почта", icon: "✉️", href: `mailto:?subject=${encodeURIComponent(text)}&body=${encodeURIComponent(message)}` },
  ];

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Буфер обмена недоступен — ссылка видна в поле, её можно выделить вручную
    }
  }

  // Системное меню «Поделиться» (есть в Windows 10+/macOS в некоторых браузерах) — там все мессенджеры сразу
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <div>
      <div className="grid grid-cols-4 gap-2 mb-3">
        {targets.map((t) => (
          <a
            key={t.name}
            href={t.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-1 rounded-card border border-line py-2.5 hover:border-ink/40 text-[11px]"
          >
            <span className="text-lg">{t.icon}</span>
            {t.name}
          </a>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.target.select()}
          className="flex-1 min-w-0 rounded-card border border-line px-2.5 py-2 text-xs text-ink/70 bg-paper"
          aria-label="Ссылка"
        />
        <button onClick={handleCopy} className="text-xs rounded-card border border-line px-3 py-2 hover:border-ink/40 shrink-0">
          {copied ? "Скопировано ✓" : "📋 Копировать"}
        </button>
        {canNativeShare && (
          <button
            onClick={() => navigator.share({ title: text, text, url }).catch(() => {})}
            className="text-xs rounded-card border border-line px-3 py-2 hover:border-ink/40 shrink-0"
            title="Другие приложения"
          >
            Ещё…
          </button>
        )}
      </div>
      {isLocalAppUrl() && (
        <p className="text-[11px] text-ink/40 mt-2 leading-relaxed">
          ⚠️ Приложение пока работает только на вашем компьютере, поэтому у других людей ссылка не откроется.
          Она заработает, когда приложение будет опубликовано в интернете.
        </p>
      )}
    </div>
  );
}
