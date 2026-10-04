import { useEffect, useState } from "react";
import {
  getFriends,
  getIncomingRequests,
  searchUsers,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  getNotebooks,
  getFlashcardSets,
  getMyPublicProfile,
  formatPublicId,
  removeFriend,
  getNotebookSharesForFriend,
  getFlashcardSetSharesForFriend,
  shareFlashcardSet,
  unshareFlashcardSet,
  shareNotebook,
  unshareNotebook,
  notifyFriendRequestsChanged,
} from "../lib/store";
import ConfirmDialog from "../components/ConfirmDialog";
import { Friend, IncomingRequest, Notebook, FlashcardSet, PublicProfile } from "../types";

export default function Friends() {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<IncomingRequest[]>([]);
  const [me, setMe] = useState<PublicProfile | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pickerFriendId, setPickerFriendId] = useState<string | null>(null);
  const [removingFriend, setRemovingFriend] = useState<Friend | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [f, r, myProfile] = await Promise.all([getFriends(), getIncomingRequests(), getMyPublicProfile()]);
      setFriends(f);
      setIncoming(r);
      setMe(myProfile);
    } finally {
      setLoading(false);
    }
  }

  async function handleAccept(requestId: string) {
    await acceptFriendRequest(requestId);
    notifyFriendRequestsChanged();
    await load();
  }

  async function handleDecline(requestId: string) {
    await declineFriendRequest(requestId);
    notifyFriendRequestsChanged();
    await load();
  }

  const pickerFriend = friends.find((f) => f.id === pickerFriendId);

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-display font-800">Друзья</h2>
          <p className="text-sm text-ink/50 mt-1">Делитесь конспектами друг с другом</p>
        </div>
        <button
          onClick={() => setSearchOpen(true)}
          className="text-sm rounded-card bg-ink text-white px-4 py-2.5 font-medium hover:bg-ink/90"
        >
          + Найти друга
        </button>
      </div>

      {me && <MyIdCard publicId={me.publicId} />}

      {incoming.length > 0 && (
        <div className="mb-6">
          <h3 className="text-xs font-medium text-ink/50 mb-2">Заявки в друзья</h3>
          <div className="flex flex-col gap-2">
            {incoming.map((r) => (
              <div key={r.id} className="rounded-card border border-line bg-card p-3 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Avatar profile={r.fromProfile} />
                  <span className="text-sm font-medium">@{r.fromProfile.username}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleAccept(r.id)}
                    className="text-xs rounded-card bg-sage/15 text-sage font-medium px-3 py-1.5 hover:bg-sage/25"
                  >
                    Принять
                  </button>
                  <button
                    onClick={() => handleDecline(r.id)}
                    className="text-xs rounded-card border border-line px-3 py-1.5 hover:border-ink/40"
                  >
                    Отклонить
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-ink/40">Загрузка…</p>
      ) : friends.length === 0 ? (
        <p className="text-sm text-ink/50">Пока нет друзей — найдите кого-нибудь по юзернейму или ID.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {friends.map((f) => (
            <div key={f.id} className="rounded-card border border-line bg-card p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Avatar profile={f.profile} size={36} />
                <div>
                  <h3 className="font-display font-700 text-sm">@{f.profile.username}</h3>
                  <p className="text-xs text-ink/40">ID {formatPublicId(f.profile.publicId)}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setPickerFriendId(f.id)}
                  className="text-xs rounded-card border border-line px-3 py-1.5 hover:border-ink/40"
                >
                  🔗 Поделиться
                </button>
                <button
                  onClick={() => setRemovingFriend(f)}
                  className="text-xs rounded-card border border-line px-2.5 py-1.5 text-ink/50 hover:border-coral hover:text-coral"
                  title="Удалить из друзей"
                  aria-label={`Удалить @${f.profile.username} из друзей`}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {removingFriend && (
        <ConfirmDialog
          title="Удалить из друзей?"
          text={`@${removingFriend.profile.username} пропадёт из вашего списка друзей, а вы — из его. Доступ к тетрадям, которыми вы делились, закроется. Потом можно снова отправить заявку.`}
          onConfirm={async () => {
            await removeFriend(removingFriend.id, removingFriend.profile.id);
            await load();
          }}
          onClose={() => setRemovingFriend(null)}
        />
      )}
      {pickerFriend && (
        <SharePicker friend={pickerFriend.profile} onClose={() => setPickerFriendId(null)} />
      )}
      {searchOpen && (
        <SearchModal
          existingFriendIds={new Set(friends.map((f) => f.profile.id))}
          pendingIds={new Set(incoming.map((r) => r.fromProfile.id))}
          onClose={() => setSearchOpen(false)}
          onSent={load}
        />
      )}
    </div>
  );
}

// Свой ID — чтобы продиктовать или отправить другу, если он не находит вас по юзернейму
function MyIdCard({ publicId }: { publicId: number }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(String(publicId));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Буфер обмена недоступен — ID всё равно виден на экране
    }
  }

  return (
    <div className="mb-6 rounded-card border border-line bg-card p-4 flex items-center justify-between">
      <div>
        <p className="text-xs text-ink/50">Ваш ID — друзья могут найти вас по нему</p>
        <p className="font-display font-800 text-lg tracking-wide">{formatPublicId(publicId)}</p>
      </div>
      <button onClick={handleCopy} className="text-xs rounded-card border border-line px-3 py-1.5 hover:border-ink/40">
        {copied ? "Скопировано ✓" : "Копировать"}
      </button>
    </div>
  );
}

function Avatar({ profile, size = 36 }: { profile: PublicProfile; size?: number }) {
  return (
    <div
      className="rounded-full bg-lavender/30 flex items-center justify-center text-sm font-semibold text-ink overflow-hidden shrink-0"
      style={{ width: size, height: size }}
    >
      {profile.avatarUrl ? (
        <img src={profile.avatarUrl} alt={profile.username} className="w-full h-full object-cover" />
      ) : (
        profile.username[0]?.toUpperCase()
      )}
    </div>
  );
}

// Поиск людей по юзернейму и отправка заявки в друзья
function SearchModal({
  existingFriendIds,
  pendingIds,
  onClose,
  onSent,
}: {
  existingFriendIds: Set<string>;
  pendingIds: Set<string>;
  onClose: () => void;
  onSent: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicProfile[]>([]);
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  useEffect(() => {
    if (query.trim().length === 0) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const found = await searchUsers(query);
        if (!cancelled) setResults(found);
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? "Ошибка поиска");
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  async function handleSend(id: string) {
    setError("");
    try {
      await sendFriendRequest(id);
      setSentIds((s) => new Set(s).add(id));
      onSent();
    } catch (err: any) {
      setError(err?.message ?? "Не получилось отправить заявку");
    }
  }

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-30 p-4" onClick={onClose}>
      <div className="bg-card rounded-card p-6 w-full max-w-sm max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-700 mb-4">Найти друга</h3>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Введите юзернейм или ID друга"
          className="w-full rounded-card border border-line px-3 py-2 text-sm mb-3"
        />
        {error && <p className="text-xs text-coral mb-2">{error}</p>}

        <div className="flex flex-col gap-1.5">
          {results.map((p) => {
            const already = existingFriendIds.has(p.id) || pendingIds.has(p.id) || sentIds.has(p.id);
            return (
              <div key={p.id} className="flex items-center justify-between rounded-card border border-line px-3 py-2">
                <div className="flex items-center gap-2">
                  <Avatar profile={p} size={28} />
                  <div>
                    <p className="text-sm">@{p.username}</p>
                    <p className="text-xs text-ink/40">ID {formatPublicId(p.publicId)}</p>
                  </div>
                </div>
                <button
                  onClick={() => handleSend(p.id)}
                  disabled={already}
                  className="text-xs rounded-card bg-ink text-white px-2.5 py-1 hover:bg-ink/90 disabled:opacity-40"
                >
                  {already ? "Отправлено" : "Добавить"}
                </button>
              </div>
            );
          })}
          {query.trim() && results.length === 0 && <p className="text-sm text-ink/40">Никого не нашлось</p>}
        </div>

        <button onClick={onClose} className="w-full text-center text-xs text-ink/50 hover:text-ink mt-4">
          Закрыть
        </button>
      </div>
    </div>
  );
}

// Что открыть другу: тетради (читать) и модули флеш-карт (изучать) — переключателями, прямо в приложении.
// Ключи в sharedKeys: "nb:<id>" для тетрадей и "set:<id>" для модулей
function SharePicker({ friend, onClose }: { friend: PublicProfile; onClose: () => void }) {
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [sets, setSets] = useState<FlashcardSet[]>([]);
  const [sharedKeys, setSharedKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [shareError, setShareError] = useState("");

  useEffect(() => {
    Promise.all([
      getNotebooks(),
      getFlashcardSets(),
      getNotebookSharesForFriend(friend.id).catch(() => [] as string[]),
      getFlashcardSetSharesForFriend(friend.id).catch(() => [] as string[]),
    ])
      .then(([nb, fs, nbShared, setShared]) => {
        setNotebooks(nb);
        setSets(fs);
        setSharedKeys(new Set([...nbShared.map((id) => `nb:${id}`), ...setShared.map((id) => `set:${id}`)]));
      })
      .catch((err) => setShareError(err?.message ?? "Не получилось загрузить"))
      .finally(() => setLoading(false));
  }, [friend.id]);

  async function toggle(key: string, share: () => Promise<void>, unshare: () => Promise<void>) {
    setBusyKey(key);
    setShareError("");
    try {
      if (sharedKeys.has(key)) {
        await unshare();
        setSharedKeys((s) => {
          const next = new Set(s);
          next.delete(key);
          return next;
        });
      } else {
        await share();
        setSharedKeys((s) => new Set(s).add(key));
      }
    } catch (err: any) {
      setShareError(err?.message ?? "Не получилось изменить доступ");
    } finally {
      setBusyKey(null);
    }
  }

  function ToggleRow({ itemKey, icon, title, onToggle }: { itemKey: string; icon: string; title: string; onToggle: () => void }) {
    const shared = sharedKeys.has(itemKey);
    return (
      <button
        onClick={onToggle}
        disabled={busyKey === itemKey}
        className={`text-left text-sm rounded-card border px-3 py-2 flex items-center gap-2 disabled:opacity-50 ${
          shared ? "border-sage bg-sage/10" : "border-line hover:border-ink/40"
        }`}
      >
        <span>{icon}</span>
        <span className="flex-1 truncate">{title}</span>
        <span className={`text-xs ${shared ? "text-sage font-medium" : "text-ink/40"}`}>{shared ? "✓ Открыто" : "Открыть"}</span>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-30 p-4" onClick={onClose}>
      <div className="bg-card rounded-card p-6 w-full max-w-sm max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-700 mb-1">Поделиться с @{friend.username}</h3>
        <p className="text-xs text-ink/50 mb-4">Друг увидит это у себя в разделе «Со мной поделились»</p>
        {shareError && <p className="text-xs text-coral mb-2">{shareError}</p>}

        {loading ? (
          <p className="text-sm text-ink/40">Загрузка…</p>
        ) : (
          <>
            {notebooks.length > 0 && (
              <>
                <p className="text-xs font-medium text-ink/40 mb-1.5">Тетради — друг сможет читать, но не менять</p>
                <div className="flex flex-col gap-1.5 mb-4">
                  {notebooks.map((n) => (
                    <ToggleRow
                      key={n.id}
                      itemKey={`nb:${n.id}`}
                      icon={n.coverImageUrl ? "📓" : n.iconEmoji}
                      title={n.title}
                      onToggle={() =>
                        toggle(`nb:${n.id}`, () => shareNotebook(n.id, friend.id), () => unshareNotebook(n.id, friend.id))
                      }
                    />
                  ))}
                </div>
              </>
            )}

            {sets.length > 0 && (
              <>
                <p className="text-xs font-medium text-ink/40 mb-1.5">Модули флеш-карт — друг сможет изучать, но не менять</p>
                <div className="flex flex-col gap-1.5">
                  {sets.map((st) => (
                    <ToggleRow
                      key={st.id}
                      itemKey={`set:${st.id}`}
                      icon="🗂️"
                      title={st.title}
                      onToggle={() =>
                        toggle(`set:${st.id}`, () => shareFlashcardSet(st.id, friend.id), () => unshareFlashcardSet(st.id, friend.id))
                      }
                    />
                  ))}
                </div>
              </>
            )}

            {notebooks.length === 0 && sets.length === 0 && (
              <p className="text-sm text-ink/50">Пока нечем делиться — создайте тетрадь или модуль флеш-карт.</p>
            )}
          </>
        )}

        <button onClick={onClose} className="w-full text-center text-xs text-ink/50 hover:text-ink mt-4">
          Закрыть
        </button>
      </div>
    </div>
  );
}
