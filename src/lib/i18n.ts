// Языки интерфейса. Исходный текст в коде — русский: он же ключ перевода.
// Для остальных языков переводы лежат в translations.ts. Если перевода нет —
// показывается русский текст, так что приложение никогда не ломается.
import { TRANSLATIONS, TRANSLATION_LANGS } from "./translations";

export const LANGUAGES = [
  { code: "ru", label: "Русский", locale: "ru-RU" },
  { code: "en", label: "English", locale: "en-US" },
  { code: "es", label: "Español", locale: "es-ES" },
  { code: "tr", label: "Türkçe", locale: "tr-TR" },
  { code: "zh", label: "中文", locale: "zh-CN" },
] as const;

export type Lang = (typeof LANGUAGES)[number]["code"];

const STORAGE_KEY = "lectiva.lang";

function isLang(v: unknown): v is Lang {
  return LANGUAGES.some((l) => l.code === v);
}

function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch {
    // localStorage может быть недоступен — тогда определяем по системе
  }
  const prefs = typeof navigator !== "undefined" ? navigator.languages ?? [navigator.language] : [];
  for (const p of prefs) {
    const base = (p || "").toLowerCase().split("-")[0];
    // Казахский, украинский, белорусский и т. п. — у таких пользователей обычно есть русский
    if (["ru", "kk", "uk", "be", "ky", "uz", "tg", "az", "hy", "ka"].includes(base)) return "ru";
    if (isLang(base)) return base;
  }
  return "en";
}

export const LANG: Lang = detectLang();
export const LOCALE: string = LANGUAGES.find((l) => l.code === LANG)!.locale;

if (typeof document !== "undefined") document.documentElement.lang = LANG;

const column = TRANSLATION_LANGS.indexOf(LANG as (typeof TRANSLATION_LANGS)[number]);

/** Перевести текст. Плейсхолдеры {0}, {1}… заменяются значениями из args. */
export function t(ru: string, args?: unknown[]): string {
  let s = ru;
  if (column >= 0) {
    const row = TRANSLATIONS[ru];
    if (row && row[column]) s = row[column];
  }
  if (args) s = s.replace(/\{(\d+)\}/g, (m, i) => (Number(i) < args.length ? String(args[Number(i)]) : m));
  return s;
}

/**
 * Слово для числа: по-русски 1 карточка / 2 карточки / 5 карточек,
 * в остальных языках — единственное число для 1, иначе множественное (перевод формы many).
 */
export function plural(n: number, one: string, few: string, many: string): string {
  if (LANG === "ru") {
    const d = n % 10, dd = n % 100;
    if (d === 1 && dd !== 11) return one;
    if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return few;
    return many;
  }
  return n === 1 ? t(one) : t(many);
}

/** Сменить язык: сохраняем выбор и перезагружаем, чтобы весь интерфейс перерисовался. */
export function setLang(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // ignore
  }
  window.location.reload();
}
