import { Fragment, useEffect, useState } from "react";
import { trackSearch } from "../lib/analytics";
import { useNavigate } from "react-router-dom";
import { searchNotebooks, currentUserId } from "../lib/store";
import { SearchResult } from "../types";

// Кусочек текста из базы: найденные слова обёрнуты в ⟦ ⟧ — подсвечиваем их.
// Строим React-элементы, а не HTML, поэтому текст конспекта не может «выполниться» как разметка
function Highlighted({ text }: { text: string }) {
  const parts = text.split(/(⟦[^⟧]*⟧)/);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("⟦") ? (
          <mark key={i} className="bg-highlight/60 text-ink rounded-sm px-0.5">
            {part.slice(1, -1)}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      )}
    </>
  );
}

// Нашлось в тексте страницы — открываем сразу эту страницу
function resultUrl(r: SearchResult): string {
  return r.pageId ? `/notebook/${r.id}?page=${r.pageId}` : `/notebook/${r.id}`;
}

export default function SearchBar() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    currentUserId().then(setMe).catch(() => {});
  }, []);

  useEffect(() => {
    if (query.trim().length === 0) {
      setResults([]);
      setError("");
      return;
    }
    let cancelled = false;
    setSearching(true);
    // Debounce ~250мс, чтобы не слать запрос на каждую нажатую букву
    const handle = setTimeout(async () => {
      try {
        const found = await searchNotebooks(query);
        trackSearch();
        if (!cancelled) {
          setResults(found);
          setError("");
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? "Не получилось выполнить поиск");
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  return (
    <div className="relative w-full md:max-w-md">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results[0]) navigate(resultUrl(results[0]));
          if (e.key === "Escape") (e.target as HTMLInputElement).blur();
        }}
        placeholder="Поиск по тетрадям и тексту конспектов…"
        aria-label="Поиск по тетрадям и конспектам"
        className="w-full rounded-card border border-line bg-card px-4 py-2.5 text-sm placeholder:text-ink/40 focus:border-ink/40"
      />

      {open && query.trim().length > 0 && (
        <div className="absolute z-20 mt-2 w-full rounded-card border border-line bg-card shadow-sm overflow-hidden max-h-[60vh] overflow-y-auto">
          {error ? (
            <p className="px-4 py-3 text-sm text-coral">{error}</p>
          ) : results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink/50">{searching ? "Ищем…" : `Ничего не нашлось по «${query}»`}</p>
          ) : (
            results.map((r) => (
              <button
                key={r.id}
                onMouseDown={() => navigate(resultUrl(r))}
                className="w-full text-left px-4 py-2.5 rule last:border-b-0 hover:bg-paper"
              >
                <span className="flex items-center gap-2 text-sm">
                  <span aria-hidden>{r.iconEmoji}</span>
                  <span className="font-medium truncate">{r.title}</span>
                  {me && r.ownerId !== me && <span className="text-[11px] text-lavender shrink-0">от друга</span>}
                </span>
                {r.pageTitle && <span className="block text-[11px] text-ink/40 mt-0.5 truncate">📄 {r.pageTitle}</span>}
                {r.snippet && (
                  <span className="block text-xs text-ink/60 mt-0.5 line-clamp-2">
                    <Highlighted text={r.snippet} />
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
