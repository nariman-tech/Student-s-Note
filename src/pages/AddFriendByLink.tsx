import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  searchUsers,
  getMyPublicProfile,
  getMyRelations,
  sendFriendRequestReturningId,
  acceptFriendRequest,
  formatPublicId,
  notifyFriendRequestsChanged,
  Relation,
} from "../lib/store";
import Icon from "../components/Icon";
import { PublicProfile } from "../types";

// Переход по ссылке-приглашению /add/<ID>: показываем, кто зовёт, и кнопку «Добавить в друзья».
// Заявка уходит пригласившему — он примет её у себя в «Друзьях». Сразу «подружить» по ссылке
// нельзя: ID не секретный, иначе кто угодно мог бы добавить себя в друзья к кому угодно
export default function AddFriendByLink() {
  const { publicId } = useParams();
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "self" }
    | { kind: "ready"; person: PublicProfile; relation?: Relation }
  >({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    const id = (publicId ?? "").replace(/\D/g, "");
    if (id.length !== 8) {
      setState({ kind: "error", message: "Ссылка-приглашение повреждена — попросите прислать её ещё раз" });
      return;
    }
    let cancelled = false;
    (async () => {
      const me = await getMyPublicProfile();
      if (me && String(me.publicId) === id) return !cancelled && setState({ kind: "self" });
      const [found, relations] = await Promise.all([searchUsers(id), getMyRelations().catch(() => new Map())]);
      if (cancelled) return;
      const person = found[0];
      if (!person) setState({ kind: "error", message: "Такого пользователя нет — возможно, он удалил аккаунт" });
      else setState({ kind: "ready", person, relation: relations.get(person.id) });
    })().catch((err) => !cancelled && setState({ kind: "error", message: err?.message ?? "Не получилось открыть приглашение" }));
    return () => {
      cancelled = true;
    };
  }, [publicId]);

  async function act(action: () => Promise<Relation>) {
    if (state.kind !== "ready") return;
    setBusy(true);
    setActionError("");
    try {
      const relation = await action();
      setState({ ...state, relation });
      notifyFriendRequestsChanged();
    } catch (err: any) {
      if (err?.code === "23505") setState({ ...state, relation: { kind: "outgoing", requestId: "" } });
      else setActionError(err?.message ?? "Не получилось");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-4 py-10 md:py-16 max-w-sm mx-auto">
      {state.kind === "loading" && <p className="text-sm text-ink/40 text-center">Открываем приглашение…</p>}

      {state.kind === "error" && (
        <div className="text-center">
          <p className="mb-4">{state.message}</p>
          <Link to="/people" className="text-sm text-ink/60 hover:text-ink">
            Найти человека в «Людях»
          </Link>
        </div>
      )}

      {state.kind === "self" && (
        <div className="text-center">
          <p className="font-display font-700 mb-1">Это ваша ссылка-приглашение</p>
          <p className="text-sm text-ink/50 mb-5">Отправьте её друзьям — открыв её, они пришлют вам заявку в друзья.</p>
          <Link to="/friends" className="text-sm rounded-card bg-ink text-white px-4 py-2.5 font-medium">
            К друзьям
          </Link>
        </div>
      )}

      {state.kind === "ready" && (
        <div className="rounded-2xl bg-card border border-line p-6 text-center shadow-lift">
          <span className="w-20 h-20 rounded-full bg-lavender/25 flex items-center justify-center text-2xl font-semibold overflow-hidden mx-auto mb-3">
            {state.person.avatarUrl ? (
              <img src={state.person.avatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              state.person.username[0]?.toUpperCase()
            )}
          </span>
          <p className="font-display font-800 text-xl">@{state.person.username}</p>
          <p className="text-xs text-ink/45 mb-1">ID {formatPublicId(state.person.publicId)}</p>
          <p className="text-sm text-ink/60 mb-5">зовёт вас в друзья в Lectiva</p>

          {state.relation?.kind === "friend" ? (
            <p className="flex items-center justify-center gap-1.5 text-sm font-semibold text-sage">
              <Icon name="check" size={16} /> Вы уже друзья
            </p>
          ) : state.relation?.kind === "outgoing" ? (
            <p className="text-sm text-ink/60">
              Заявка отправлена — когда @{state.person.username} примет её, вы появитесь друг у друга в «Друзьях»
            </p>
          ) : state.relation?.kind === "incoming" ? (
            <button
              onClick={() =>
                act(async () => {
                  await acceptFriendRequest(state.relation!.requestId);
                  return { kind: "friend", requestId: state.relation!.requestId };
                })
              }
              disabled={busy}
              className="w-full rounded-card bg-sage text-white py-3 text-sm font-semibold disabled:opacity-50"
            >
              {busy ? "Секунду…" : "Принять заявку"}
            </button>
          ) : (
            <button
              onClick={() => act(async () => ({ kind: "outgoing", requestId: await sendFriendRequestReturningId(state.person.id) }))}
              disabled={busy}
              className="w-full flex items-center justify-center gap-2 rounded-card bg-ink text-white py-3 text-sm font-semibold disabled:opacity-50"
            >
              <Icon name="userPlus" size={16} />
              {busy ? "Отправляем…" : "Добавить в друзья"}
            </button>
          )}
          {actionError && <p className="text-xs text-coral mt-3">{actionError}</p>}

          <Link to="/friends" className="block text-xs text-ink/50 hover:text-ink mt-5">
            Перейти к друзьям
          </Link>
        </div>
      )}
    </div>
  );
}
