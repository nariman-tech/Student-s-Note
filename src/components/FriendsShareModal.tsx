import { useEffect, useState } from "react";
import { track } from "../lib/analytics";
import { getFriends, formatPublicId } from "../lib/store";
import { Friend } from "../types";
import MessengerShare from "./MessengerShare";

// "Поделиться" тетрадью или модулем флеш-карт: отмечаем друзей, которым он открыт.
// Друг увидит его в разделе «Со мной поделились». Что именно открываем, задают loadShared/share/unshare.
export interface ShareTarget {
  heading: string; // «Поделиться тетрадью»
  hint: string; // что сможет друг
  loadShared: () => Promise<string[]>; // id друзей, которым уже открыто
  share: (friendUserId: string) => Promise<void>;
  unshare: (friendUserId: string) => Promise<void>;
  // Доступ по ссылке (для мессенджеров): токен ссылки или null, если выключен
  link?: {
    load: () => Promise<string | null>;
    enable: () => Promise<string>;
    disable: () => Promise<void>;
    url: (token: string) => string;
    messageText: string; // «Посмотри мой конспект «…» в приложении Lectiva»
  };
}

export default function FriendsShareModal({ title, target, onClose }: { title: string; target: ShareTarget; onClose: () => void }) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [sharedWith, setSharedWith] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);

  useEffect(() => {
    Promise.all([getFriends(), target.loadShared(), target.link?.load() ?? Promise.resolve(null)])
      .then(([f, shares, token]) => {
        setFriends(f);
        setSharedWith(new Set(shares));
        setLinkToken(token);
      })
      .catch((err) => setError(err?.message ?? "Не получилось загрузить друзей"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleLink() {
    if (!target.link) return;
    setLinkBusy(true);
    setError("");
    try {
      if (linkToken) {
        await target.link.disable();
        setLinkToken(null);
      } else {
        setLinkToken(await target.link.enable());
        track("share_link_enabled");
      }
    } catch (err: any) {
      setError(err?.message ?? "Не получилось изменить доступ по ссылке");
    } finally {
      setLinkBusy(false);
    }
  }

  async function toggle(friendUserId: string) {
    setBusyId(friendUserId);
    setError("");
    try {
      if (sharedWith.has(friendUserId)) {
        await target.unshare(friendUserId);
        setSharedWith((s) => {
          const next = new Set(s);
          next.delete(friendUserId);
          return next;
        });
      } else {
        await target.share(friendUserId);
        setSharedWith((s) => new Set(s).add(friendUserId));
      }
    } catch (err: any) {
      setError(err?.message ?? "Не получилось изменить доступ");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-30 p-4" onClick={onClose}>
      <div className="bg-card rounded-card p-6 w-full max-w-sm max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-700 mb-1">{target.heading}</h3>
        <p className="text-xs text-ink/50 mb-4">
          «{title}» — {target.hint}
        </p>

        {error && <p className="text-xs text-coral mb-2">{error}</p>}

        {loading ? (
          <p className="text-sm text-ink/40">Загрузка…</p>
        ) : friends.length === 0 ? (
          <p className="text-sm text-ink/50">Пока нет друзей — добавьте их на странице «Друзья».</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {friends.map((f) => {
              const shared = sharedWith.has(f.profile.id);
              return (
                <button
                  key={f.id}
                  onClick={() => toggle(f.profile.id)}
                  disabled={busyId === f.profile.id}
                  className={`text-left rounded-card border px-3 py-2 flex items-center gap-2.5 disabled:opacity-50 ${
                    shared ? "border-sage bg-sage/10" : "border-line hover:border-ink/40"
                  }`}
                >
                  <span className="w-7 h-7 rounded-full bg-lavender/30 flex items-center justify-center text-xs font-semibold overflow-hidden shrink-0">
                    {f.profile.avatarUrl ? (
                      <img src={f.profile.avatarUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      f.profile.username[0]?.toUpperCase()
                    )}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm truncate">@{f.profile.username}</span>
                    <span className="block text-xs text-ink/40">ID {formatPublicId(f.profile.publicId)}</span>
                  </span>
                  <span className={`text-xs ${shared ? "text-sage font-medium" : "text-ink/40"}`}>
                    {shared ? "✓ Открыта" : "Открыть"}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {target.link && !loading && (
          <div className="mt-5 pt-4 border-t border-line">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <p className="text-sm font-medium">Доступ по ссылке</p>
                <p className="text-xs text-ink/50">
                  {linkToken ? "Любой, у кого есть ссылка, может открыть — даже без аккаунта" : "Выключен — отправить в мессенджер можно после включения"}
                </p>
              </div>
              <button
                onClick={toggleLink}
                disabled={linkBusy}
                role="switch"
                aria-checked={!!linkToken}
                aria-label="Доступ по ссылке"
                className={`relative w-11 h-6 rounded-full shrink-0 transition-colors disabled:opacity-50 ${linkToken ? "bg-sage" : "bg-line"}`}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${linkToken ? "left-[22px]" : "left-0.5"}`}
                />
              </button>
            </div>
            {linkToken && <MessengerShare url={target.link.url(linkToken)} text={target.link.messageText} />}
          </div>
        )}

        <button onClick={onClose} className="w-full text-center text-xs text-ink/50 hover:text-ink mt-4">
          Готово
        </button>
      </div>
    </div>
  );
}
