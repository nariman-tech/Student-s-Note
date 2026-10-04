import { useEffect, useState } from "react";
import { track } from "../lib/analytics";
import { addFlashcard, createFlashcardSet, getFlashcardSetTitles } from "../lib/store";

// Делим выделенный текст на термин и определение по первому разделителю:
// «Сила — векторная величина…», «Сила: векторная…», «Сила - векторная…».
// Разделителя нет — весь текст идёт в термин, определение студент допишет сам.
export function splitTermDefinition(raw: string): { front: string; back: string } {
  const text = raw.replace(/\s+/g, " ").trim();
  const match = text.match(/^(.{1,200}?)\s*(?:\s[—–-]\s|[—–]|:\s)\s*(.+)$/);
  if (match) return { front: match[1].trim(), back: match[2].trim() };
  return { front: text, back: "" };
}

const NEW_SET = "__new__";

// «В карточку»: выделили текст в конспекте → карточка в модуль флеш-карт.
// По умолчанию — модуль с названием тетради (если такого нет, он создаётся).
export default function CardFromSelectionModal({
  selectedText,
  notebookTitle,
  onSaved,
  onClose,
}: {
  selectedText: string;
  notebookTitle: string;
  onSaved: (setTitle: string) => void; // редактор показывает «✓ Карточка добавлена в …»
  onClose: () => void;
}) {
  const initial = splitTermDefinition(selectedText);
  const [front, setFront] = useState(initial.front);
  const [back, setBack] = useState(initial.back);
  const [sets, setSets] = useState<{ id: string; title: string }[] | null>(null);
  const [setId, setSetId] = useState<string>(NEW_SET);
  const [newSetTitle, setNewSetTitle] = useState(notebookTitle);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getFlashcardSetTitles()
      .then((list) => {
        setSets(list);
        // Уже есть модуль с названием тетради — добавляем в него
        const same = list.find((s) => s.title.trim().toLowerCase() === notebookTitle.trim().toLowerCase());
        if (same) setSetId(same.id);
      })
      .catch((err) => setError(err?.message ?? "Не получилось загрузить модули"));
  }, [notebookTitle]);

  const canSave = !saving && front.trim().length > 0 && back.trim().length > 0 && (setId !== NEW_SET || newSetTitle.trim().length > 0);

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      if (setId === NEW_SET) {
        // Модуль с названием тетради — следующие карточки из неё найдут его и пойдут туда же
        const created = await createFlashcardSet(newSetTitle.trim(), [{ front: front.trim(), back: back.trim() }]);
        onSaved(created.title);
      } else {
        await addFlashcard(setId, front.trim(), back.trim());
        onSaved(sets?.find((s) => s.id === setId)?.title ?? "");
      }
      track("card_from_selection");
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "Не получилось сохранить карточку");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-40 p-4" onClick={onClose}>
      <div className="bg-card rounded-card p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-700 mb-1">Новая карточка</h3>
        <p className="text-xs text-ink/50 mb-4">Из выделенного текста. Проверьте и поправьте, если нужно.</p>

        <label className="text-xs text-ink/50 mb-1 block" htmlFor="card-front">
          Термин (лицевая сторона)
        </label>
        <textarea
          id="card-front"
          value={front}
          onChange={(e) => setFront(e.target.value)}
          rows={2}
          className="w-full rounded-card border border-line px-3 py-2 text-sm mb-3 resize-none"
        />
        <label className="text-xs text-ink/50 mb-1 block" htmlFor="card-back">
          Определение (обратная сторона)
        </label>
        <textarea
          id="card-back"
          value={back}
          onChange={(e) => setBack(e.target.value)}
          rows={3}
          autoFocus={!initial.back}
          placeholder="Допишите определение"
          className="w-full rounded-card border border-line px-3 py-2 text-sm mb-3 resize-none"
        />

        <label className="text-xs text-ink/50 mb-1 block" htmlFor="card-set">
          Модуль флеш-карт
        </label>
        <select
          id="card-set"
          value={setId}
          onChange={(e) => setSetId(e.target.value)}
          disabled={sets === null}
          className="w-full rounded-card border border-line px-3 py-2 text-sm mb-2 bg-card"
        >
          <option value={NEW_SET}>+ Новый модуль…</option>
          {(sets ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        {setId === NEW_SET && (
          <input
            value={newSetTitle}
            onChange={(e) => setNewSetTitle(e.target.value)}
            maxLength={80}
            placeholder="Название нового модуля"
            aria-label="Название нового модуля"
            className="w-full rounded-card border border-line px-3 py-2 text-sm mb-2"
          />
        )}

        {error && <p className="text-xs text-coral mt-2">{error}</p>}

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-2 text-sm text-ink/60 hover:text-ink">
            Отмена
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="px-4 py-2 text-sm rounded-card bg-ink text-white hover:bg-ink/90 disabled:opacity-40"
          >
            {saving ? "Сохраняем…" : "Создать карточку"}
          </button>
        </div>
      </div>
    </div>
  );
}
