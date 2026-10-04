import { useEffect, useRef, useState } from "react";
import { getNotebooks, addNotebook, getSharedWithMe } from "../lib/store";
import { uploadImage } from "../lib/upload";
import NotebookCard from "../components/NotebookCard";
import SearchBar from "../components/SearchBar";
import { Notebook, SharedNotebook } from "../types";

const COLORS = ["#FF6B5B", "#8C8FE0", "#6B9080", "#FFC93C", "#5AA9E6"];

export default function Notebooks() {
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [shared, setShared] = useState<SharedNotebook[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);
  const [title, setTitle] = useState("");
  // cover — локальное превью (blob:), coverFile — сам файл; в Storage грузим только при создании тетради
  const [cover, setCover] = useState<string | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [mine, sharedWithMe] = await Promise.all([getNotebooks(), getSharedWithMe().catch(() => [])]);
      setNotebooks(mine);
      setShared(sharedWithMe);
    } finally {
      setLoading(false);
    }
  }

  function handleCoverChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (cover) URL.revokeObjectURL(cover);
    setCover(URL.createObjectURL(file));
    setCoverFile(file);
  }

  function resetModal() {
    setTitle("");
    if (cover) URL.revokeObjectURL(cover);
    setCover(null);
    setCoverFile(null);
    setShowNewModal(false);
    setCreateError("");
  }

  async function handleCreate() {
    if (!title.trim()) return;
    setCreating(true);
    setCreateError("");
    try {
      const color = COLORS[Math.floor(Math.random() * COLORS.length)];
      const coverImageUrl = coverFile ? await uploadImage(coverFile, 800) : undefined;
      await addNotebook({ title: title.trim(), coverImageUrl, spineColor: color });
      await load();
      resetModal();
    } catch (err: any) {
      setCreateError(err?.message ?? "Не получилось создать тетрадь");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 gap-4">
        <div>
          <h2 className="text-2xl font-display font-800">Мои тетради</h2>
          <p className="text-sm text-ink/50 mt-1">Все конспекты в одном месте</p>
        </div>
        <SearchBar />
      </div>

      <button
        onClick={() => setShowNewModal(true)}
        className="mb-6 inline-flex items-center gap-2 rounded-card bg-ink text-white text-sm font-medium px-4 py-2.5 hover:bg-ink/90"
      >
        + Новая тетрадь
      </button>

      {loading ? (
        <p className="text-sm text-ink/40">Загрузка…</p>
      ) : notebooks.length === 0 ? (
        <p className="text-sm text-ink/50">Пока нет ни одной тетради — создайте первую.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {notebooks.map((nb) => (
            <NotebookCard key={nb.id} notebook={nb} />
          ))}
        </div>
      )}

      {shared.length > 0 && (
        <div className="mt-10">
          <h3 className="font-display font-700 mb-1">Со мной поделились</h3>
          <p className="text-sm text-ink/50 mb-4">Тетради друзей — можно читать, но не менять</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {shared.map((s) => (
              <NotebookCard key={s.notebook.id} notebook={s.notebook} ownerUsername={s.owner.username} />
            ))}
          </div>
        </div>
      )}

      {showNewModal && (
        <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-20" onClick={resetModal}>
          <div className="bg-card rounded-card p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display font-700 mb-4">Новая тетрадь</h3>

            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              className="w-full rounded-card border border-line px-3 py-2 text-sm mb-3"
              placeholder="Название тетради — придумайте своё"
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full h-28 rounded-card border-2 border-dashed border-line mb-1 overflow-hidden flex flex-col items-center justify-center gap-1 hover:border-ink/40"
            >
              {cover ? (
                <img src={cover} alt="Обложка" className="w-full h-full object-cover" />
              ) : (
                <>
                  <span className="text-xl">🖼️</span>
                  <span className="text-xs text-ink/50">Своя обложка (необязательно)</span>
                </>
              )}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleCoverChange} />
            {cover && (
              <button
                type="button"
                onClick={() => {
                  setCover(null);
                  setCoverFile(null);
                }}
                className="text-xs text-ink/50 hover:text-ink mb-3">
                Убрать обложку
              </button>
            )}

            {createError && <p className="text-xs text-coral mb-3">{createError}</p>}

            <div className="flex justify-end gap-2 mt-4">
              <button onClick={resetModal} className="px-4 py-2 text-sm text-ink/60 hover:text-ink">
                Отмена
              </button>
              <button
                onClick={handleCreate}
                disabled={!title.trim() || creating}
                className="px-4 py-2 text-sm rounded-card bg-ink text-white hover:bg-ink/90 disabled:opacity-40"
              >
                {creating ? "Создаём…" : "Создать"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
