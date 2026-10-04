import { useState } from "react";
import { PageSummary } from "../types";

// Вкладки страниц тетради: «Лекция 1 | Лекция 2 | + Страница». У открытой страницы (для владельца) —
// переименовать, сдвинуть влево/вправо, удалить. Много страниц — вкладки прокручиваются вбок.
export default function PageTabs({
  pages,
  currentId,
  readOnly,
  onSelect,
  onAdd,
  onRename,
  onMove,
  onDelete,
}: {
  pages: PageSummary[];
  currentId: string | null;
  readOnly: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, title: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const currentIndex = pages.findIndex((p) => p.id === currentId);

  function finishRename() {
    if (!editing) return;
    const title = editing.title.trim();
    const original = pages.find((p) => p.id === editing.id)?.title;
    setEditing(null);
    if (title && title !== original) onRename(editing.id, title);
  }

  return (
    <div className="mb-3">
      <div className="flex items-end gap-1 overflow-x-auto border-b border-line" role="tablist" aria-label="Страницы тетради">
        {pages.map((p) => {
          const active = p.id === currentId;
          if (editing?.id === p.id) {
            return (
              <input
                key={p.id}
                autoFocus
                value={editing.title}
                onChange={(e) => setEditing({ id: p.id, title: e.target.value })}
                onBlur={finishRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") finishRename();
                  if (e.key === "Escape") setEditing(null);
                }}
                maxLength={120}
                aria-label="Название страницы"
                className="text-sm rounded-t-card border border-b-0 border-ink/40 px-3 py-2 w-44 shrink-0 outline-none"
              />
            );
          }
          return (
            <button
              key={p.id}
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(p.id)}
              onDoubleClick={() => !readOnly && setEditing({ id: p.id, title: p.title })}
              title={readOnly ? p.title : `${p.title} — двойной клик, чтобы переименовать`}
              className={`text-sm px-3 py-2 rounded-t-card border border-b-0 shrink-0 max-w-[200px] truncate -mb-px ${
                active ? "bg-card border-line font-medium text-ink" : "border-transparent text-ink/50 hover:text-ink"
              }`}
            >
              {p.title}
            </button>
          );
        })}
        {!readOnly && (
          <button onClick={onAdd} className="text-sm px-3 py-2 shrink-0 text-ink/50 hover:text-ink" title="Новая страница">
            + Страница
          </button>
        )}
      </div>

      {!readOnly && currentId && editing === null && (
        <div className="flex items-center gap-3 mt-1.5 text-xs text-ink/40">
          <button onClick={() => setEditing({ id: currentId, title: pages[currentIndex]?.title ?? "" })} className="hover:text-ink">
            ✏️ Переименовать страницу
          </button>
          <button onClick={() => onMove(currentId, -1)} disabled={currentIndex <= 0} className="hover:text-ink disabled:opacity-30" aria-label="Сдвинуть страницу влево" title="Сдвинуть влево">
            ←
          </button>
          <button
            onClick={() => onMove(currentId, 1)}
            disabled={currentIndex === -1 || currentIndex >= pages.length - 1}
            className="hover:text-ink disabled:opacity-30"
            aria-label="Сдвинуть страницу вправо"
            title="Сдвинуть вправо"
          >
            →
          </button>
          {pages.length > 1 && (
            <button onClick={() => onDelete(currentId)} className="hover:text-coral ml-auto">
              🗑 Удалить страницу
            </button>
          )}
        </div>
      )}
    </div>
  );
}
