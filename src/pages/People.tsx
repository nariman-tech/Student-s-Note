import { useEffect, useRef, useState } from "react";
import {
  listPeople,
  getMyRelations,
  sendFriendRequestReturningId,
  acceptFriendRequest,
  declineFriendRequest,
  formatPublicId,
  notifyFriendRequestsChanged,
  PEOPLE_PAGE,
  Relation,
} from "../lib/store";
import { useOnline } from "../lib/offline";
import Icon from "../components/Icon";
import { PublicProfile } from "../types";

// «Люди» — все пользователи Lectiva: список с поиском по нику или ID, кнопка «Обновить»,
// и прямо в строке — добавить в друзья, отменить заявку или принять входящую
export default function People() {
  const online = useOnline();
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<PublicProfile[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [relations, setRelations] = useState<Map<string, Relation>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const requestNo = useRef(0); // ответ на старый запрос (пока печатали) не должен затереть новый

  async function load(q: string, mode: "first" | "refresh" = "first") {
    const no = ++requestNo.current;
    if (mode === "first") setLoading(true);
    else setRefreshing(true);
    setError("");
    try {
      const [{ people: found, total: count }, rel] = await Promise.all([
        listPeople(q),
        getMyRelations().catch(() => relations),
      ]);
      if (no !== requestNo.current) return;
      setPeople(found);
      setTotal(count);
      setRelations(rel);
    } catch (err: any) {
      if (no === requestNo.current) setError(err?.message ?? "Не получилось загрузить список");
    } finally {
      if (no === requestNo.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }

  // Поиск — через 300 мс после того, как перестали печатать
  useEffect(() => {
    const t = window.setTimeout(() => load(query), query ? 300 : 0);
    return () => window.clearTimeout(t);
  }, [query]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const { people: more } = await listPeople(query, people.length);
      setPeople((prev) => [...prev, ...more.filter((p) => !prev.some((x) => x.id === p.id))]);
    } catch (err: any) {
      setError(err?.message ?? "Не получилось загрузить ещё");
    } finally {
      setLoadingMore(false);
    }
  }

  function setRelation(id: string, rel: Relation | null) {
    setRelations((prev) => {
      const next = new Map(prev);
      if (rel) next.set(id, rel);
      else next.delete(id);
      return next;
    });
  }

  const hasMore = total !== null && people.length < total;
  const isIdLike = /^\s*(id|#)?\s*:?\s*[\d\s-]+$/i.test(query) && query.replace(/\D/g, "").length > 0;
  const idIncomplete = isIdLike && query.replace(/\D/g, "").length < 8;

  return (
    <div className="px-4 py-6 md:px-10 md:py-10 max-w-2xl mx-auto">
      <div className="flex items-end justify-between gap-3 mb-6">
        <div>
          <h2 className="text-3xl md:text-4xl font-display font-800">Люди</h2>
          <p className="text-sm text-ink/50 mt-1">
            {total !== null && !query.trim() ? `${total} ${peopleWord(total)} в Lectiva` : "Все, кто учится в Lectiva"}
          </p>
        </div>
        <button
          onClick={() => load(query, "refresh")}
          disabled={refreshing || loading || !online}
          className="shrink-0 flex items-center gap-2 rounded-card border border-line bg-card px-3.5 py-2.5 text-sm font-medium hover:border-ink/40 disabled:opacity-50"
          title="Обновить список"
        >
          <Icon name="refresh" size={16} className={refreshing ? "animate-spin" : ""} />
          <span className="hidden sm:inline">{refreshing ? "Обновляем…" : "Обновить"}</span>
        </button>
      </div>

      <div className="relative mb-5">
        <Icon name="search" size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink/40 pointer-events-none" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ник или ID из 8 цифр"
          className="w-full rounded-card border border-line pl-10 pr-10 py-3 text-sm"
          autoComplete="off"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full text-ink/40 hover:text-ink hover:bg-paper"
            aria-label="Очистить поиск"
          >
            <Icon name="close" size={16} />
          </button>
        )}
      </div>

      {!online && <p className="text-xs text-ink/50 mb-4">Нет интернета — показан последний сохранённый список, поиск недоступен.</p>}
      {idIncomplete && <p className="text-xs text-ink/50 mb-4">ID состоит из 8 цифр — введите его полностью.</p>}
      {error && <p className="text-sm text-coral mb-4">{error}</p>}

      {loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[68px] rounded-card bg-line/50 animate-pulse" />
          ))}
        </div>
      ) : people.length === 0 ? (
        !error &&
        !idIncomplete && (
          <div className="text-center py-12">
            <p className="font-display font-700">{query.trim() ? "Никого не нашли" : "Пока здесь только вы"}</p>
            <p className="text-sm text-ink/50 mt-1">
              {query.trim() ? "Проверьте ник или ID — ник пишется латиницей" : "Позовите одногруппников — они появятся здесь"}
            </p>
          </div>
        )
      ) : (
        <ul className="rounded-2xl bg-card border border-line divide-y divide-line overflow-hidden">
          {people.map((p) => (
            <PersonRow key={p.id} person={p} relation={relations.get(p.id)} onChange={(rel) => setRelation(p.id, rel)} />
          ))}
        </ul>
      )}

      {hasMore && !loading && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="w-full mt-4 rounded-card border border-line bg-card py-2.5 text-sm font-medium hover:border-ink/40 disabled:opacity-50"
        >
          {loadingMore ? "Загружаем…" : `Показать ещё ${Math.min(PEOPLE_PAGE, (total ?? 0) - people.length)}`}
        </button>
      )}
    </div>
  );
}

function PersonRow({
  person,
  relation,
  onChange,
}: {
  person: PublicProfile;
  relation?: Relation;
  onChange: (rel: Relation | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(action: () => Promise<Relation | null>) {
    setBusy(true);
    setError("");
    try {
      onChange(await action());
      notifyFriendRequestsChanged();
    } catch (err: any) {
      // Заявку уже отправили (например, с другого устройства) — показываем как отправленную
      if (err?.code === "23505") onChange({ kind: "outgoing", requestId: "" });
      else setError(err?.message ?? "Не получилось");
    } finally {
      setBusy(false);
    }
  }

  const add = () => run(async () => ({ kind: "outgoing", requestId: await sendFriendRequestReturningId(person.id) }));
  const cancel = () => run(async () => (relation?.requestId ? (await declineFriendRequest(relation.requestId), null) : relation ?? null));
  const accept = () => run(async () => (await acceptFriendRequest(relation!.requestId), { kind: "friend", requestId: relation!.requestId }));

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="w-11 h-11 rounded-full bg-lavender/25 flex items-center justify-center text-sm font-semibold overflow-hidden shrink-0">
        {person.avatarUrl ? (
          <img src={person.avatarUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          person.username[0]?.toUpperCase()
        )}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">@{person.username}</p>
        <p className="text-xs text-ink/45">ID {formatPublicId(person.publicId)}</p>
        {error && <p className="text-xs text-coral mt-0.5">{error}</p>}
      </div>

      {relation?.kind === "friend" ? (
        <span className="shrink-0 flex items-center gap-1.5 text-xs font-semibold text-sage bg-sage/10 rounded-full px-3 py-1.5">
          <Icon name="check" size={14} />
          В друзьях
        </span>
      ) : relation?.kind === "outgoing" ? (
        <button
          onClick={cancel}
          disabled={busy}
          className="shrink-0 text-xs font-medium rounded-card border border-line px-3 py-2 text-ink/60 hover:text-ink hover:border-ink/40 disabled:opacity-50"
          title="Отменить заявку"
        >
          {busy ? "…" : (
            <span className="flex items-center gap-1">
              Заявка отправлена
              <Icon name="close" size={13} />
            </span>
          )}
        </button>
      ) : relation?.kind === "incoming" ? (
        <button
          onClick={accept}
          disabled={busy}
          className="shrink-0 text-xs font-semibold rounded-card bg-sage text-white px-3 py-2 hover:brightness-95 disabled:opacity-50"
        >
          {busy ? "…" : "Принять заявку"}
        </button>
      ) : (
        <button
          onClick={add}
          disabled={busy}
          className="shrink-0 flex items-center gap-1 text-xs font-semibold rounded-card bg-ink text-white px-3 py-2 hover:bg-ink/90 disabled:opacity-50"
        >
          <Icon name="plus" size={14} />
          {busy ? "…" : "В друзья"}
        </button>
      )}
    </li>
  );
}

// 1 человек, 2 человека, 5 человек
function peopleWord(n: number): string {
  const d = n % 10,
    dd = n % 100;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return "человека";
  return "человек";
}
