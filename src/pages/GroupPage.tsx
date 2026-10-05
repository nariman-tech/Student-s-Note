import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { track } from "../lib/analytics";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  getGroup,
  getGroupMembers,
  getGroupMessages,
  sendGroupMessage,
  deleteGroupMessage,
  subscribeToGroupMessages,
  leaveGroup,
  deleteGroup,
  removeGroupMember,
  currentUserId,
  getPublicProfile,
  formatPublicId,
  MESSAGES_PAGE,
  getFriends,
  addFriendToGroup,
  getGroupNotebooks,
  addNotebook,
} from "../lib/store";
import { groupInviteLink } from "../lib/links";
import MessengerShare from "../components/MessengerShare";
import { uploadChatAttachment, isUploadedFileUrl, formatFileSize } from "../lib/upload";
import ConfirmDialog from "../components/ConfirmDialog";
import { Friend, Group, GroupMember, GroupMessage, Notebook, PublicProfile } from "../types";
import NotebookCard from "../components/NotebookCard";

const MAX_MESSAGE_LENGTH = 4000; // совпадает с проверкой в базе

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Сегодня";
  if (d.toDateString() === yesterday.toDateString()) return "Вчера";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

export default function GroupPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [group, setGroup] = useState<Group | undefined>(undefined);
  const [notFound, setNotFound] = useState(false);
  const [me, setMe] = useState<string>("");
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // Профили авторов, которых уже нет в группе (вышли) — подгружаем по одному и запоминаем
  const [extraProfiles, setExtraProfiles] = useState<Record<string, PublicProfile>>({});

  const [membersOpen, setMembersOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  // Вкладки группы: чат или общие тетради (?tab=notebooks в адресе — чтобы «назад» из тетради возвращал сюда)
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "notebooks" ? "notebooks" : "chat";
  const [confirm, setConfirm] = useState<"leave" | "delete" | null>(null);
  const [deletingMessage, setDeletingMessage] = useState<GroupMessage | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true); // держим прокрутку внизу, если пользователь не листает историю
  const keepScrollFrom = useRef<number | null>(null); // высота списка до подгрузки старых сообщений

  useEffect(() => {
    if (!id) return;
    // cancelled — страницу уже закрыли (или React в режиме разработки перезапустил эффект),
    // пока шла загрузка: тогда не подписываемся на чат, иначе останется лишняя подписка
    let cancelled = false;
    let unsubscribe = () => {};
    (async () => {
      const [g, userId] = await Promise.all([getGroup(id), currentUserId()]);
      if (cancelled) return;
      if (!g) {
        setNotFound(true);
        return;
      }
      setMe(userId);
      setGroup(g);
      const [m, msgs] = await Promise.all([getGroupMembers(id), getGroupMessages(id)]);
      if (cancelled) return;
      setMembers(m);
      setMessages(msgs);
      setHasOlder(msgs.length === MESSAGES_PAGE);

      unsubscribe = subscribeToGroupMessages(id, {
        // Своё сообщение уже добавлено после отправки — дубль по id отбрасываем
        onInsert: (msg) => setMessages((list) => (list.some((x) => x.id === msg.id) ? list : [...list, msg])),
        onDelete: (msgId) => setMessages((list) => list.filter((x) => x.id !== msgId)),
      });
    })().catch((err) => {
      console.error("Не получилось открыть группу", err);
      if (!cancelled) setNotFound(true);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [id]);

  const profilesById: Record<string, PublicProfile> = { ...extraProfiles };
  for (const m of members) profilesById[m.profile.id] = m.profile;

  // Автор сообщения вышел из группы — подгружаем его профиль отдельно
  useEffect(() => {
    const missing = [...new Set(messages.map((m) => m.authorId).filter((a): a is string => !!a && !profilesById[a]))];
    if (missing.length === 0 || members.length === 0) return;
    missing.forEach((authorId) =>
      getPublicProfile(authorId)
        .then((p) => p && setExtraProfiles((prev) => ({ ...prev, [authorId]: p })))
        .catch(() => {})
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, members]);

  // Прокрутка: после подгрузки старых сообщений остаёмся на том же месте, при новых — вниз
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (keepScrollFrom.current !== null) {
      el.scrollTop = el.scrollHeight - keepScrollFrom.current;
      keepScrollFrom.current = null;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, tab]);

  function handleScroll() {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  async function loadOlder() {
    if (!id || messages.length === 0) return;
    setLoadingOlder(true);
    try {
      const older = await getGroupMessages(id, messages[0].createdAt);
      keepScrollFrom.current = listRef.current?.scrollHeight ?? null;
      setMessages((list) => [...older, ...list]);
      setHasOlder(older.length === MESSAGES_PAGE);
    } finally {
      setLoadingOlder(false);
    }
  }

  async function handleCopyCode() {
    if (!group) return;
    try {
      await navigator.clipboard.writeText(group.inviteCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 1500);
    } catch {
      // Буфер обмена недоступен — код и так виден
    }
  }

  if (notFound) {
    return (
      <div className="p-8">
        <p className="mb-3">Группа не найдена — возможно, её удалили или вас исключили.</p>
        <Link to="/groups" className="text-sm text-ink/60 hover:text-ink">
          ← Все группы
        </Link>
      </div>
    );
  }
  if (!group) {
    return <div className="p-8 text-sm text-ink/40">Загрузка…</div>;
  }

  const isOwner = group.ownerId === me;

  return (
    <div className="h-[calc(100dvh-8.5rem)] md:h-screen flex flex-col max-w-3xl mx-auto px-3 md:px-8 pt-3 md:pt-6 pb-2 md:pb-4">
      {/* Шапка группы */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4 mb-3 md:mb-4">
        <div className="min-w-0">
          <Link to="/groups" className="text-xs text-ink/50 hover:text-ink">
            ← Все группы
          </Link>
          <h2 className="text-xl font-display font-800 truncate">{group.name}</h2>
          <p className="text-xs text-ink/50">
            {group.university ? `${group.university} · ` : ""}
            <button onClick={() => setMembersOpen(true)} className="underline hover:text-ink">
              участники: {members.length || group.memberCount /* пока список участников грузится */}
            </button>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            onClick={() => setInviteOpen(true)}
            className="text-xs rounded-card bg-ink text-white px-3 py-2 font-medium hover:bg-ink/90"
          >
            👥 Пригласить
          </button>
          <button
            onClick={handleCopyCode}
            className="text-xs rounded-card border border-line px-3 py-2 hover:border-ink/40"
            title="Код для вступления — отправьте его одногруппникам"
          >
            Код: <span className="font-mono font-semibold tracking-wider">{group.inviteCode}</span>{" "}
            {codeCopied ? "✓" : "📋"}
          </button>
          <button
            onClick={() => setConfirm(isOwner ? "delete" : "leave")}
            className="text-xs rounded-card border border-line px-3 py-2 hover:border-coral hover:text-coral"
          >
            {isOwner ? "🗑 Удалить группу" : "Выйти"}
          </button>
        </div>
      </div>

      <div className="flex gap-1 mb-2" role="tablist" aria-label="Разделы группы">
        {[
          { key: "chat", label: "💬 Чат" },
          { key: "notebooks", label: "📚 Тетради группы" },
        ].map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => {
              if (t.key === "chat") stickToBottom.current = true;
              setSearchParams(t.key === "chat" ? {} : { tab: t.key }, { replace: true });
            }}
            className={`text-sm px-3 py-1.5 rounded-card ${tab === t.key ? "bg-ink text-white font-medium" : "text-ink/60 hover:text-ink hover:bg-card"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "notebooks" ? (
        <GroupNotebooks group={group} />
      ) : (
      <>
      {/* Сообщения */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto rounded-card border border-line bg-card px-4 py-3"
      >
        {hasOlder && (
          <div className="text-center mb-3">
            <button onClick={loadOlder} disabled={loadingOlder} className="text-xs text-ink/50 hover:text-ink">
              {loadingOlder ? "Загружаем…" : "Показать более ранние сообщения"}
            </button>
          </div>
        )}
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-ink/40 text-center">
            Здесь пока пусто. Напишите первое сообщение или отправьте фото доски 📸
          </div>
        ) : (
          messages.map((m, i) => {
            const prev = messages[i - 1];
            const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
            // Подряд идущие сообщения одного автора (в пределах 5 минут) — без повтора имени
            const grouped =
              !newDay &&
              prev.authorId === m.authorId &&
              new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
            return (
              <div key={m.id}>
                {newDay && (
                  <div className="text-center my-3">
                    <span className="text-[11px] text-ink/40 bg-paper rounded-full px-3 py-1">{formatDay(m.createdAt)}</span>
                  </div>
                )}
                <MessageRow
                  message={m}
                  author={m.authorId ? profilesById[m.authorId] : undefined}
                  mine={m.authorId === me}
                  grouped={grouped}
                  canDelete={m.authorId === me || isOwner}
                  onDelete={() => setDeletingMessage(m)}
                />
              </div>
            );
          })
        )}
      </div>

      <Composer
        groupId={group.id}
        onSent={(msg) => {
          stickToBottom.current = true;
          setMessages((list) => (list.some((x) => x.id === msg.id) ? list : [...list, msg]));
        }}
      />
      </>
      )}

      {inviteOpen && (
        <InviteModal
          group={group}
          memberIds={new Set(members.map((m) => m.profile.id))}
          onAdded={async () => setMembers(await getGroupMembers(group.id))}
          onClose={() => setInviteOpen(false)}
        />
      )}
      {membersOpen && (
        <MembersModal
          groupId={group.id}
          members={members}
          me={me}
          isOwner={isOwner}
          onChanged={async () => setMembers(await getGroupMembers(group.id))}
          onClose={() => setMembersOpen(false)}
        />
      )}
      {confirm === "leave" && (
        <ConfirmDialog
          title="Выйти из группы?"
          text={`Вы перестанете видеть чат «${group.name}». Вернуться можно по коду приглашения.`}
          confirmLabel="Выйти"
          onConfirm={async () => {
            await leaveGroup(group.id);
            navigate("/groups");
          }}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === "delete" && (
        <ConfirmDialog
          title="Удалить группу?"
          text={`«${group.name}» удалится у всех участников вместе с перепиской. Отменить это нельзя.`}
          onConfirm={async () => {
            await deleteGroup(group.id);
            navigate("/groups");
          }}
          onClose={() => setConfirm(null)}
        />
      )}
      {deletingMessage && (
        <ConfirmDialog
          title="Удалить сообщение?"
          text="Сообщение пропадёт у всех участников группы."
          onConfirm={async () => {
            await deleteGroupMessage(deletingMessage);
            setMessages((list) => list.filter((x) => x.id !== deletingMessage.id));
          }}
          onClose={() => setDeletingMessage(null)}
        />
      )}
    </div>
  );
}

function Avatar({ profile, size = 32 }: { profile?: PublicProfile; size?: number }) {
  return (
    <div
      className="rounded-full bg-lavender/30 flex items-center justify-center text-xs font-semibold text-ink overflow-hidden shrink-0"
      style={{ width: size, height: size }}
    >
      {profile?.avatarUrl ? (
        <img src={profile.avatarUrl} alt="" className="w-full h-full object-cover" />
      ) : (
        profile?.username[0]?.toUpperCase() ?? "?"
      )}
    </div>
  );
}

function MessageRow({
  message,
  author,
  mine,
  grouped,
  canDelete,
  onDelete,
}: {
  message: GroupMessage;
  author?: PublicProfile;
  mine: boolean;
  grouped: boolean;
  canDelete: boolean;
  onDelete: () => void;
}) {
  const att = message.attachment && isUploadedFileUrl(message.attachment.url) ? message.attachment : undefined;
  return (
    <div className={`group flex gap-2.5 ${grouped ? "mt-1" : "mt-3"} ${mine ? "flex-row-reverse" : ""}`}>
      <div className="w-8 shrink-0">{!grouped && !mine && <Avatar profile={author} />}</div>
      <div className={`max-w-[85%] md:max-w-[75%] flex flex-col ${mine ? "items-end" : "items-start"}`}>
        {!grouped && !mine && (
          <span className="text-xs text-ink/50 mb-0.5">{author ? `@${author.username}` : "Удалённый пользователь"}</span>
        )}
        <div className={`flex items-end gap-1.5 ${mine ? "flex-row-reverse" : ""}`}>
          <div
            className={`rounded-card px-3 py-2 text-sm ${
              mine ? "bg-ink text-white" : "bg-paper text-ink"
            }`}
          >
            {att?.type === "image" && (
              <a href={att.url} target="_blank" rel="noopener noreferrer" className="block mb-1">
                <img src={att.url} alt={att.name} className="rounded-card max-h-64 max-w-full object-contain" loading="lazy" />
              </a>
            )}
            {att?.type === "file" && (
              <a
                href={att.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center gap-2 rounded-card px-2.5 py-2 mb-1 ${mine ? "bg-white/10" : "bg-card border border-line"}`}
              >
                <span className="text-lg">📄</span>
                <span className="min-w-0">
                  <span className="block truncate max-w-[220px]">{att.name}</span>
                  <span className={`block text-[11px] ${mine ? "text-white/60" : "text-ink/40"}`}>{formatFileSize(att.size)}</span>
                </span>
              </a>
            )}
            {message.body && <p className="whitespace-pre-wrap break-words">{message.body}</p>}
            <span className={`block text-[10px] mt-0.5 text-right ${mine ? "text-white/50" : "text-ink/35"}`}>
              {formatTime(message.createdAt)}
            </span>
          </div>
          {canDelete && (
            <button
              onClick={onDelete}
              className="md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 text-ink/30 hover:text-coral text-xs mb-1"
              title="Удалить сообщение"
              aria-label="Удалить сообщение"
            >
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Composer({ groupId, onSent }: { groupId: string; onSent: (m: GroupMessage) => void }) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function pickFile(f: File | null) {
    setFile(f);
    setPreview(f && f.type.startsWith("image/") ? URL.createObjectURL(f) : null);
    setError("");
  }

  const canSend = !sending && (text.trim().length > 0 || file !== null);

  async function handleSend() {
    if (!canSend) return;
    setSending(true);
    setError("");
    try {
      const attachment = file ? await uploadChatAttachment(file) : undefined;
      const msg = await sendGroupMessage(groupId, text.trim(), attachment);
      onSent(msg);
      setText("");
      pickFile(null);
      textRef.current?.focus();
    } catch (err: any) {
      setError(err?.message ?? "Не получилось отправить сообщение");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-3">
      {file && (
        <div className="flex items-center gap-3 mb-2 rounded-card border border-line bg-card p-2">
          {preview ? (
            <img src={preview} alt="" className="w-12 h-12 rounded-card object-cover" />
          ) : (
            <span className="w-12 h-12 rounded-card bg-paper flex items-center justify-center text-xl">📄</span>
          )}
          <span className="flex-1 min-w-0">
            <span className="block text-sm truncate">{file.name}</span>
            <span className="block text-xs text-ink/40">{formatFileSize(file.size)}</span>
          </span>
          <button onClick={() => pickFile(null)} disabled={sending} className="text-ink/40 hover:text-coral px-2" aria-label="Убрать файл">
            ✕
          </button>
        </div>
      )}
      {error && <p className="text-xs text-coral mb-2">{error}</p>}
      <div className="flex items-end gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={sending}
          className="w-10 h-10 rounded-card border border-line hover:border-ink/40 flex items-center justify-center shrink-0"
          title="Прикрепить фото или файл"
          aria-label="Прикрепить фото или файл"
        >
          📎
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            pickFile(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
        <textarea
          ref={textRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter — отправить, Shift+Enter — новая строка
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          onPaste={(e) => {
            // Вставка скриншота из буфера обмена (Ctrl+V) сразу прикрепляет его
            const pasted = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
            if (pasted) {
              e.preventDefault();
              pickFile(pasted);
            }
          }}
          rows={1}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder="Сообщение…"
          className="flex-1 resize-none rounded-card border border-line px-3 py-2.5 text-sm max-h-40 outline-none focus:border-ink/40"
        />
        <button
          onClick={handleSend}
          disabled={!canSend}
          className="h-10 px-4 rounded-card bg-ink text-white text-sm font-medium hover:bg-ink/90 disabled:opacity-40 shrink-0"
        >
          {sending ? (file ? "Загружаем…" : "…") : "Отправить"}
        </button>
      </div>
      <p className="hidden md:block text-[11px] text-ink/35 mt-1 ml-12">
        Enter — отправить, Shift+Enter — новая строка, Ctrl+V — вставить скриншот
      </p>
    </div>
  );
}

function MembersModal({
  groupId,
  members,
  me,
  isOwner,
  onChanged,
  onClose,
}: {
  groupId: string;
  members: GroupMember[];
  me: string;
  isOwner: boolean;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [removing, setRemoving] = useState<GroupMember | null>(null);

  return (
    <>
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-30 p-4" onClick={onClose}>
      <div className="bg-card rounded-card p-6 w-full max-w-sm max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-700 mb-4">Участники ({members.length})</h3>
        <div className="flex flex-col gap-2">
          {members.map((m) => (
            <div key={m.profile.id} className="flex items-center gap-2.5">
              <Avatar profile={m.profile} />
              <span className="flex-1 min-w-0">
                <span className="block text-sm truncate">
                  @{m.profile.username}
                  {m.profile.id === me && <span className="text-ink/40"> (вы)</span>}
                </span>
                <span className="block text-xs text-ink/40">
                  {m.role === "owner" ? "Создатель · " : ""}ID {formatPublicId(m.profile.publicId)}
                </span>
              </span>
              {isOwner && m.role !== "owner" && (
                <button
                  onClick={() => setRemoving(m)}
                  className="text-xs text-ink/40 hover:text-coral px-2"
                  title="Исключить из группы"
                  aria-label={`Исключить @${m.profile.username}`}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
        <button onClick={onClose} className="w-full text-center text-xs text-ink/50 hover:text-ink mt-5">
          Закрыть
        </button>
      </div>
    </div>
      {removing && (
        <ConfirmDialog
          title="Исключить из группы?"
          text={`@${removing.profile.username} больше не увидит чат. Вернуться он сможет только по коду приглашения.`}
          confirmLabel="Исключить"
          onConfirm={async () => {
            await removeGroupMember(groupId, removing.profile.id);
            await onChanged();
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </>
  );
}

// Пригласить в группу: добавить своих друзей одной кнопкой или отправить ссылку в мессенджер
function InviteModal({
  group,
  memberIds,
  onAdded,
  onClose,
}: {
  group: Group;
  memberIds: Set<string>;
  onAdded: () => Promise<void>;
  onClose: () => void;
}) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  useEffect(() => {
    getFriends()
      .then(setFriends)
      .catch((err) => setError(err?.message ?? "Не получилось загрузить друзей"))
      .finally(() => setLoading(false));
  }, []);

  async function handleAdd(friendId: string) {
    setBusyId(friendId);
    setError("");
    try {
      await addFriendToGroup(group.id, friendId);
      setAdded((s) => new Set(s).add(friendId));
      await onAdded();
    } catch (err: any) {
      setError(err?.message ?? "Не получилось добавить в группу");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-30 p-4" onClick={onClose}>
      <div className="bg-card rounded-card p-6 w-full max-w-sm max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-700 mb-1">Пригласить в группу</h3>
        <p className="text-xs text-ink/50 mb-4">«{group.name}»</p>

        <p className="text-xs font-medium text-ink/40 mb-1.5">Ваши друзья</p>
        {error && <p className="text-xs text-coral mb-2">{error}</p>}
        {loading ? (
          <p className="text-sm text-ink/40 mb-4">Загрузка…</p>
        ) : friends.length === 0 ? (
          <p className="text-sm text-ink/50 mb-4">Пока нет друзей — добавьте их на странице «Друзья» или отправьте ссылку ниже.</p>
        ) : (
          <div className="flex flex-col gap-1.5 mb-4">
            {friends.map((f) => {
              const inGroup = memberIds.has(f.profile.id) || added.has(f.profile.id);
              return (
                <div key={f.id} className="flex items-center gap-2.5 rounded-card border border-line px-3 py-2">
                  <Avatar profile={f.profile} size={28} />
                  <span className="flex-1 min-w-0 text-sm truncate">@{f.profile.username}</span>
                  <button
                    onClick={() => handleAdd(f.profile.id)}
                    disabled={inGroup || busyId === f.profile.id}
                    className="text-xs rounded-card bg-ink text-white px-2.5 py-1 hover:bg-ink/90 disabled:bg-sage/15 disabled:text-sage"
                  >
                    {inGroup ? "✓ В группе" : busyId === f.profile.id ? "…" : "Добавить"}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="pt-4 border-t border-line">
          <p className="text-xs font-medium text-ink/40 mb-1">Ссылка-приглашение</p>
          <p className="text-xs text-ink/50 mb-3">
            Кто откроет ссылку, сразу вступит в группу (после входа в аккаунт). Или продиктуйте код:{" "}
            <span className="font-mono font-semibold text-ink tracking-wider">{group.inviteCode}</span>
          </p>
          <MessengerShare url={groupInviteLink(group.inviteCode)} text={`Вступай в нашу группу «${group.name}» в приложении Lectiva`} />
        </div>

        <button onClick={onClose} className="w-full text-center text-xs text-ink/50 hover:text-ink mt-4">
          Готово
        </button>
      </div>
    </div>
  );
}

const NOTEBOOK_COLORS = ["#FF6B5B", "#8C8FE0", "#6B9080", "#FFC93C", "#5AA9E6"];

// Общие тетради группы: конспекты курса, которые дописывают все участники
function GroupNotebooks({ group }: { group: Group }) {
  const navigate = useNavigate();
  const [notebooks, setNotebooks] = useState<Notebook[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getGroupNotebooks(group.id)
      .then(setNotebooks)
      .catch((err) => setError(err?.message ?? "Не получилось загрузить тетради группы"));
  }, [group.id]);

  async function handleCreate() {
    if (!title.trim()) return;
    setBusy(true);
    setError("");
    try {
      const nb = await addNotebook({
        title: title.trim(),
        spineColor: NOTEBOOK_COLORS[Math.floor(Math.random() * NOTEBOOK_COLORS.length)],
        groupId: group.id,
      });
      track("group_notebook_created");
      navigate(`/notebook/${nb.id}`);
    } catch (err: any) {
      setError(err?.message ?? "Не получилось создать тетрадь");
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <p className="text-sm text-ink/50">Конспекты курса — читают и дописывают все участники группы</p>
        <button
          onClick={() => setCreating(true)}
          className="text-sm rounded-card bg-ink text-white px-4 py-2 font-medium hover:bg-ink/90"
        >
          + Тетрадь группы
        </button>
      </div>

      {creating && (
        <div className="mb-4 rounded-card border border-line bg-card p-4 flex flex-col sm:flex-row gap-2">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") setCreating(false);
            }}
            maxLength={120}
            placeholder="Название, например «Матанализ — лекции»"
            aria-label="Название тетради группы"
            className="flex-1 rounded-card border border-line px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button onClick={() => setCreating(false)} className="px-3 py-2 text-sm text-ink/60 hover:text-ink">
              Отмена
            </button>
            <button
              onClick={handleCreate}
              disabled={!title.trim() || busy}
              className="px-4 py-2 text-sm rounded-card bg-ink text-white hover:bg-ink/90 disabled:opacity-40"
            >
              {busy ? "Создаём…" : "Создать"}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-coral mb-3">{error}</p>}
      {notebooks === null ? (
        !error && <p className="text-sm text-ink/40">Загрузка…</p>
      ) : notebooks.length === 0 ? (
        <p className="text-sm text-ink/50">
          Пока нет общих тетрадей. Создайте тетрадь по предмету — одногруппники смогут дописывать в неё свои конспекты.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {notebooks.map((nb) => (
            <NotebookCard key={nb.id} notebook={nb} />
          ))}
        </div>
      )}
    </div>
  );
}
