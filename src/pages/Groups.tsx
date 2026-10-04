import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getGroups, addGroup, joinGroupByCode } from "../lib/store";
import { Group } from "../types";

function membersLabel(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} участник`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} участника`;
  return `${n} участников`;
}

export default function Groups() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [modal, setModal] = useState<"create" | "join" | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      setGroups(await getGroups());
    } catch (err: any) {
      setLoadError(err?.message ?? "Не получилось загрузить группы");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
        <div>
          <h2 className="text-2xl font-display font-800">Группы</h2>
          <p className="text-sm text-ink/50 mt-1">Универы, курсы и потоки — с общим чатом</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => setModal("join")}
            className="text-sm rounded-card border border-line px-4 py-2.5 font-medium hover:border-ink/40"
          >
            Вступить по коду
          </button>
          <button
            onClick={() => setModal("create")}
            className="text-sm rounded-card bg-ink text-white px-4 py-2.5 font-medium hover:bg-ink/90"
          >
            + Создать группу
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-ink/40">Загрузка…</p>
      ) : loadError ? (
        <p className="text-sm text-coral">{loadError}</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-ink/50">
          Пока нет групп — создайте группу для своего курса или вступите по коду, который дал одногруппник.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g) => (
            <Link
              key={g.id}
              to={`/groups/${g.id}`}
              className="rounded-card border border-line bg-card p-4 flex items-center justify-between hover:border-ink/30"
            >
              <div>
                <h3 className="font-display font-700 text-sm">{g.name}</h3>
                <p className="text-xs text-ink/50 mt-0.5">
                  {g.university ? `${g.university} · ` : ""}
                  {membersLabel(g.memberCount)}
                </p>
              </div>
              <span className="text-sm text-ink/40">Открыть чат →</span>
            </Link>
          ))}
        </div>
      )}

      {modal === "create" && (
        <CreateGroupModal
          onClose={() => setModal(null)}
          onCreated={(id) => navigate(`/groups/${id}`)}
        />
      )}
      {modal === "join" && <JoinGroupModal onClose={() => setModal(null)} onJoined={(id) => navigate(`/groups/${id}`)} />}
    </div>
  );
}

function CreateGroupModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [university, setUniversity] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    setError("");
    try {
      const group = await addGroup(name.trim(), university.trim() || undefined);
      onCreated(group.id);
    } catch (err: any) {
      setError(err?.message ?? "Не получилось создать группу");
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-20 p-4" onClick={onClose}>
      <div className="bg-card rounded-card p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-700 mb-4">Новая группа</h3>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          maxLength={80}
          placeholder="Название, например «ФизФак 2027, поток Б»"
          className="w-full rounded-card border border-line px-3 py-2 text-sm mb-3"
        />
        <input
          value={university}
          onChange={(e) => setUniversity(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          maxLength={80}
          placeholder="Университет (необязательно)"
          className="w-full rounded-card border border-line px-3 py-2 text-sm mb-3"
        />
        <p className="text-[11px] text-ink/40">После создания вы получите код — по нему одногруппники смогут вступить.</p>
        {error && <p className="text-xs text-coral mt-3">{error}</p>}

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-2 text-sm text-ink/60 hover:text-ink">
            Отмена
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || creating}
            className="px-4 py-2 text-sm rounded-card bg-ink text-white hover:bg-ink/90 disabled:opacity-40"
          >
            {creating ? "Создаём…" : "Создать"}
          </button>
        </div>
      </div>
    </div>
  );
}

function JoinGroupModal({ onClose, onJoined }: { onClose: () => void; onJoined: (id: string) => void }) {
  const [code, setCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");

  async function handleJoin() {
    const clean = code.replace(/\s/g, "");
    if (!clean) return;
    setJoining(true);
    setError("");
    try {
      onJoined(await joinGroupByCode(clean));
    } catch (err: any) {
      setError(err?.message ?? "Не получилось вступить в группу");
      setJoining(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-20 p-4" onClick={onClose}>
      <div className="bg-card rounded-card p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-700 mb-1">Вступить в группу</h3>
        <p className="text-xs text-ink/50 mb-4">Попросите код у любого участника группы</p>
        <input
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && handleJoin()}
          maxLength={12}
          placeholder="Код, например K7XMP2QA"
          className="w-full rounded-card border border-line px-3 py-2 text-sm font-mono tracking-widest mb-1"
        />
        {error && <p className="text-xs text-coral mt-2">{error}</p>}

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-2 text-sm text-ink/60 hover:text-ink">
            Отмена
          </button>
          <button
            onClick={handleJoin}
            disabled={!code.trim() || joining}
            className="px-4 py-2 text-sm rounded-card bg-ink text-white hover:bg-ink/90 disabled:opacity-40"
          >
            {joining ? "Вступаем…" : "Вступить"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Переход по ссылке-приглашению /join/<код>: вступаем и открываем чат группы.
// Если человек не вошёл, App сначала покажет экран входа, а после входа вернёт сюда же
export function JoinByLink() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    joinGroupByCode(code)
      .then((id) => !cancelled && navigate(`/groups/${id}`, { replace: true }))
      .catch((err) => !cancelled && setError(err?.message ?? "Не получилось вступить в группу"));
    return () => {
      cancelled = true;
    };
  }, [code, navigate]);

  return (
    <div className="p-8">
      {error ? (
        <>
          <p className="mb-3">{error}</p>
          <Link to="/groups" className="text-sm text-ink/60 hover:text-ink">
            ← Все группы
          </Link>
        </>
      ) : (
        <p className="text-sm text-ink/40">Вступаем в группу…</p>
      )}
    </div>
  );
}
