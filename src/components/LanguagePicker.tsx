import Icon from "./Icon";
import { LANG, LANGUAGES, Lang, setLang, t } from "../lib/i18n";

// Выбор языка интерфейса. После выбора страница перезагружается на новом языке.
export default function LanguagePicker({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  return (
    <label className={`inline-flex items-center gap-2 text-sm ${className}`}>
      <Icon name="globe" size={compact ? 16 : 18} className="text-ink/60 shrink-0" />
      <span className="sr-only">{t("Язык")}</span>
      <select
        value={LANG}
        onChange={(e) => setLang(e.target.value as Lang)}
        className="bg-transparent border border-line rounded-lg px-2 py-1.5 text-sm cursor-pointer hover:border-ink/30 focus:outline-none focus:border-ink/40"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}
