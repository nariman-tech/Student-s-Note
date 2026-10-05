import { useEffect, useState } from "react";
import {
  getFlashcardSets,
  createFlashcardSet,
  updateFlashcardSet,
  deleteFlashcardSet,
  getSharedFlashcardSetsWithMe,
  getFlashcardSetShares,
  shareFlashcardSet,
  unshareFlashcardSet,
} from "../lib/store";
import { FlashcardSet, SharedFlashcardSet } from "../types";
import FriendsShareModal, { ShareTarget } from "../components/FriendsShareModal";
import { getShareToken, enableShareLink, disableShareLink, flashcardSetLink } from "../lib/links";
import ConfirmDialog from "../components/ConfirmDialog";

type CardRow = { front: string; back: string };

function setShareTarget(setId: string, title: string): ShareTarget {
  return {
    heading: "Поделиться модулем",
    hint: "отмеченные друзья смогут изучать карточки в приложении, но не менять.",
    loadShared: () => getFlashcardSetShares(setId),
    share: (friendId) => shareFlashcardSet(setId, friendId),
    unshare: (friendId) => unshareFlashcardSet(setId, friendId),
    link: {
      load: () => getShareToken("flashcard_sets", setId),
      enable: () => enableShareLink("flashcard_sets", setId),
      disable: () => disableShareLink("flashcard_sets", setId),
      url: flashcardSetLink,
      messageText: `Поучи со мной флеш-карты «${title}» в приложении Lectiva`,
    },
  };
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function Flashcards() {
  const [sets, setSets] = useState<FlashcardSet[]>([]);
  const [shared, setShared] = useState<SharedFlashcardSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSetId, setActiveSetId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingSet, setEditingSet] = useState<FlashcardSet | null>(null);
  const [deletingSet, setDeletingSet] = useState<FlashcardSet | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [mine, sharedWithMe] = await Promise.all([getFlashcardSets(), getSharedFlashcardSetsWithMe().catch(() => [])]);
      setSets(mine);
      setShared(sharedWithMe);
    } finally {
      setLoading(false);
    }
  }

  const activeShared = shared.find((s) => s.set.id === activeSetId);
  const activeSet = sets.find((s) => s.id === activeSetId) ?? activeShared?.set;

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      {loading ? (
        <p className="text-sm text-ink/40">Загрузка…</p>
      ) : !activeSet ? (
        <ModulesGrid
          sets={sets}
          shared={shared}
          onOpen={setActiveSetId}
          onCreate={() => setShowCreate(true)}
        />
      ) : (
        <StudySession
          key={activeSet.cards.map((c) => c.id).join()} // после редактирования у карточек новые id — сессия начинается заново
          set={activeSet}
          onBack={() => setActiveSetId(null)}
          ownerUsername={activeShared?.owner.username}
          onEdit={() => setEditingSet(activeSet)}
          onDelete={() => setDeletingSet(activeSet)}
        />
      )}

      {editingSet && (
        <CreateSetModal
          editSet={editingSet}
          onClose={() => setEditingSet(null)}
          onCreated={async () => {
            await load();
            setEditingSet(null);
          }}
        />
      )}
      {deletingSet && (
        <ConfirmDialog
          title="Удалить модуль?"
          text={`«${deletingSet.title}» удалится вместе со всеми карточками (${deletingSet.cards.length}). Отменить это нельзя.`}
          onConfirm={async () => {
            await deleteFlashcardSet(deletingSet.id);
            setActiveSetId(null);
            await load();
          }}
          onClose={() => setDeletingSet(null)}
        />
      )}
      {showCreate && (
        <CreateSetModal
          onClose={() => setShowCreate(false)}
          onCreated={async (id) => {
            await load();
            setActiveSetId(id);
            setShowCreate(false);
          }}
        />
      )}
    </div>
  );
}

// --- Сетка модулей — те же "квадратные стопки", что и тетради ---

function ModulesGrid({
  sets,
  shared,
  onOpen,
  onCreate,
}: {
  sets: FlashcardSet[];
  shared: SharedFlashcardSet[];
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-display font-800">Модули флеш-карт</h2>
          <p className="text-sm text-ink/50 mt-1">Свои наборы терминов для изучения</p>
        </div>
        <button
          onClick={onCreate}
          className="text-sm rounded-card bg-ink text-white px-4 py-2.5 font-medium hover:bg-ink/90"
        >
          + Создать модуль
        </button>
      </div>

      {sets.length === 0 ? (
        <p className="text-sm text-ink/50">Пока нет модулей — создайте первый.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
          {sets.map((s) => (
            <ModuleCard key={s.id} set={s} onOpen={() => onOpen(s.id)} />
          ))}
        </div>
      )}

      {shared.length > 0 && (
        <div className="mt-10">
          <h3 className="font-display font-700 mb-1">Со мной поделились</h3>
          <p className="text-sm text-ink/50 mb-4">Модули друзей — можно изучать, но не менять</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
            {shared.map((s) => (
              <ModuleCard key={s.set.id} set={s.set} ownerUsername={s.owner.username} onOpen={() => onOpen(s.set.id)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ownerUsername — чужой модуль из «Со мной поделились»: без кнопки «поделиться»
function ModuleCard({ set, ownerUsername, onOpen }: { set: FlashcardSet; ownerUsername?: string; onOpen: () => void }) {
  const [shareOpen, setShareOpen] = useState(false);
  return (
    <div className="relative">
      {/* Две подложки позади создают эффект "стопки карточек" */}
      <div className="absolute inset-x-2 -bottom-1.5 h-full rounded-card border border-line bg-card" aria-hidden />
      <div className="absolute inset-x-1 -bottom-0.5 h-full rounded-card border border-line bg-card" aria-hidden />

      <button onClick={onOpen} className="relative w-full text-left rounded-card border border-line bg-card overflow-hidden hover:border-ink/30">
        <div
          className="w-full aspect-square flex items-center justify-center text-3xl"
          style={{ backgroundColor: set.color }}
        >
          🗂️
        </div>
        <div className="p-3">
          <h3 className="font-display font-700 text-sm leading-snug mb-1 line-clamp-2">{set.title}</h3>
          {ownerUsername && <p className="text-xs text-lavender font-medium mb-0.5">от @{ownerUsername}</p>}
          <p className="text-xs text-ink/50">{set.cards.length} карточек</p>
        </div>
      </button>

      {!ownerUsername && (
      <button
        onClick={(e) => {
          e.stopPropagation();
          setShareOpen(true);
        }}
        className="absolute top-2 right-2 w-7 h-7 rounded-full bg-card/90 border border-line flex items-center justify-center text-xs hover:border-ink/40"
        aria-label="Поделиться модулем"
        title="Поделиться"
      >
        🔗
      </button>
      )}

      {shareOpen && <FriendsShareModal title={set.title} target={setShareTarget(set.id, set.title)} onClose={() => setShareOpen(false)} />}
    </div>
  );
}

// --- Изучение выбранного модуля: переворот карточки + сортировка знаю/не знаю ---

// Экспортируется: тот же экран изучения показывается и при открытии модуля по ссылке (PublicView)
export function StudySession({
  set,
  ownerUsername,
  onBack,
  onEdit,
  onDelete,
}: {
  set: FlashcardSet;
  ownerUsername?: string; // чужой модуль — только изучение
  onBack?: () => void; // нет — модуль открыт по ссылке, возвращаться некуда
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const [queue, setQueue] = useState<string[]>(() => shuffle(set.cards.map((c) => c.id)));
  const [knownCount, setKnownCount] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const currentCard = set.cards.find((c) => c.id === queue[0]);

  function restart() {
    setQueue(shuffle(set.cards.map((c) => c.id)));
    setKnownCount(0);
    setFlipped(false);
  }

  function handleKnow() {
    setKnownCount((n) => n + 1);
    setQueue((q) => q.slice(1));
    setFlipped(false);
  }

  function handleDontKnow() {
    setQueue((q) => [...q.slice(1), q[0]]);
    setFlipped(false);
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        {onBack ? (
          <button onClick={onBack} className="text-sm text-ink/50 hover:text-ink flex items-center gap-1">
            ← Все модули
          </button>
        ) : (
          <span />
        )}
        {!ownerUsername && (
        <div className="flex items-center gap-2">
          <button
            onClick={onEdit}
            className="text-sm rounded-card border border-line px-3 py-2 hover:border-ink/40 flex items-center gap-1.5"
          >
            ✏️ Изменить
          </button>
          <button
            onClick={() => setShareOpen(true)}
            className="text-sm rounded-card border border-line px-3 py-2 hover:border-ink/40 flex items-center gap-1.5"
          >
            🔗 Поделиться
          </button>
          <button
            onClick={onDelete}
            className="text-sm rounded-card border border-line px-3 py-2 hover:border-coral hover:text-coral"
            title="Удалить модуль"
            aria-label="Удалить модуль"
          >
            🗑
          </button>
        </div>
        )}
      </div>

      <h2 className="text-xl font-display font-800 mb-1">{set.title}</h2>
      {ownerUsername && <p className="text-xs text-ink/40">Модуль @{ownerUsername} · только изучение</p>}

      {set.cards.length === 0 ? (
        <p className="text-sm text-ink/50 mt-4">В этом модуле пока нет карточек.</p>
      ) : currentCard ? (
        <>
          <p className="text-xs text-ink/40 mb-2 mt-4">
            Знаю: {knownCount} / {set.cards.length} · Осталось изучить: {queue.length}
          </p>
          <button
            onClick={() => setFlipped((f) => !f)}
            className="w-full h-64 rounded-card border border-line bg-card flex items-center justify-center text-center p-8 text-lg font-medium hover:border-ink/30"
          >
            {flipped ? currentCard.back : currentCard.front}
          </button>
          <p className="text-center text-xs text-ink/40 mt-3">
            Нажмите на карточку, чтобы перевернуть и увидеть {flipped ? "термин" : "определение"}
          </p>

          <div className="flex justify-center gap-3 mt-4">
            <button
              onClick={handleDontKnow}
              className="px-5 py-2.5 text-sm rounded-card bg-coral/15 text-coral font-medium hover:bg-coral/25"
            >
              ✕ Не знаю
            </button>
            <button
              onClick={handleKnow}
              className="px-5 py-2.5 text-sm rounded-card bg-sage/15 text-sage font-medium hover:bg-sage/25"
            >
              ✓ Знаю
            </button>
          </div>
        </>
      ) : (
        <div className="text-center py-16">
          <p className="text-3xl mb-3">🎉</p>
          <p className="font-display font-700 mb-1">Вы выучили весь модуль!</p>
          <p className="text-sm text-ink/50 mb-5">
            {knownCount} из {set.cards.length} карточек — знаю
          </p>
          <button onClick={restart} className="px-4 py-2 text-sm rounded-card bg-ink text-white hover:bg-ink/90">
            Повторить ещё раз
          </button>
        </div>
      )}

      {shareOpen && <FriendsShareModal title={set.title} target={setShareTarget(set.id, set.title)} onClose={() => setShareOpen(false)} />}
    </div>
  );
}

// --- Создание модуля: термин + определение для каждой карточки, как в Quizlet ---

// Та же форма служит и для редактирования: если передан editSet — поля заполнены его данными
function CreateSetModal({
  editSet,
  onClose,
  onCreated,
}: {
  editSet?: FlashcardSet;
  onClose: () => void;
  onCreated: (id: string) => void | Promise<void>;
}) {
  const [title, setTitle] = useState(editSet?.title ?? "");
  const [rows, setRows] = useState<CardRow[]>(
    editSet && editSet.cards.length > 0
      ? editSet.cards.map((c) => ({ front: c.front, back: c.back }))
      : [
          { front: "", back: "" },
          { front: "", back: "" },
        ]
  );
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  function updateRow(i: number, key: keyof CardRow, value: string) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [key]: value } : row)));
  }

  function addRow() {
    setRows((r) => [...r, { front: "", back: "" }]);
  }

  function removeRow(i: number) {
    setRows((r) => r.filter((_, idx) => idx !== i));
  }

  const validRows = rows.filter((r) => r.front.trim() && r.back.trim());
  const canCreate = title.trim() && validRows.length > 0;

  async function handleCreate() {
    if (!canCreate) return;
    setCreating(true);
    setCreateError("");
    try {
      if (editSet) {
        await updateFlashcardSet(editSet.id, title.trim(), validRows);
        await onCreated(editSet.id);
      } else {
        const set = await createFlashcardSet(title.trim(), validRows);
        await onCreated(set.id);
      }
    } catch (err: any) {
      setCreateError(err?.message ?? (editSet ? "Не получилось сохранить модуль" : "Не получилось создать модуль"));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-30 p-4" onClick={onClose}>
      <div className="bg-card rounded-card p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-700 mb-4">{editSet ? "Изменить модуль" : "Новый модуль флеш-карт"}</h3>

        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Название модуля, например «Формулы — механика»"
          className="w-full rounded-card border border-line px-3 py-2 text-sm mb-4"
        />

        <div className="flex flex-col gap-2 mb-3">
          {rows.map((row, i) => (
            <div key={i} className="flex gap-2 items-start">
              <span className="text-xs text-ink/40 mt-2.5 w-4">{i + 1}</span>
              <input
                value={row.front}
                onChange={(e) => updateRow(i, "front", e.target.value)}
                placeholder="Термин"
                className="flex-1 rounded-card border border-line px-3 py-2 text-sm"
              />
              <input
                value={row.back}
                onChange={(e) => updateRow(i, "back", e.target.value)}
                placeholder="Определение"
                className="flex-1 rounded-card border border-line px-3 py-2 text-sm"
              />
              <button
                onClick={() => removeRow(i)}
                disabled={rows.length <= 1}
                className="text-ink/30 hover:text-coral text-sm mt-2 disabled:opacity-0"
                aria-label="Удалить карточку"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <button onClick={addRow} className="text-sm text-ink/60 hover:text-ink mb-4">
          + Добавить карточку
        </button>

        {createError && <p className="text-xs text-coral mb-3">{createError}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-ink/60 hover:text-ink">
            Отмена
          </button>
          <button
            onClick={handleCreate}
            disabled={!canCreate || creating}
            className="px-4 py-2 text-sm rounded-card bg-ink text-white hover:bg-ink/90 disabled:opacity-40"
          >
            {creating ? (editSet ? "Сохраняем…" : "Создаём…") : editSet ? "Сохранить" : "Создать модуль"}
          </button>
        </div>
      </div>
    </div>
  );
}
