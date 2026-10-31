import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PublicProfile } from "../types";
import { formatPublicId, getNotebooks, getSharedWithMe, getPages, getPage, getFlashcardSets, getGroups } from "../lib/store";
import { supabase } from "../lib/supabase";
import { signOut } from "../lib/auth";
import { deleteMyAccount, DeletionStep } from "../lib/account";
import { isAdmin } from "../lib/analytics";
import { useOnline, usePendingCount } from "../lib/offline";
import ProfileModal from "../components/ProfileModal";
import { FeedbackModal } from "../components/Feedback";
import ConfirmDialog from "../components/ConfirmDialog";
import Icon, { IconName } from "../components/Icon";

// Настройки: профиль, вход, работа без интернета, помощь и удаление аккаунта
export default function Settings({
  profile,
  onProfileChange,
}: {
  profile: PublicProfile;
  onProfileChange: (p: PublicProfile) => void;
}) {
  const [email, setEmail] = useState<string | undefined>();
  const [profileOpen, setProfileOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [admin, setAdmin] = useState(false);
  const pending = usePendingCount();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? undefined));
    isAdmin().then(setAdmin).catch(() => {});
  }, []);

  return (
    <div className="px-4 py-6 md:px-10 md:py-10 max-w-2xl mx-auto">
      <h2 className="text-3xl md:text-4xl font-display font-800 mb-8">Настройки</h2>

      {/* Профиль */}
      <section className="rounded-2xl bg-card border border-line p-5 flex items-center gap-4 mb-8">
        <span className="w-16 h-16 rounded-full bg-highlight flex items-center justify-center text-ink text-xl font-semibold overflow-hidden shrink-0">
          {profile.avatarUrl ? (
            <img src={profile.avatarUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            profile.username[0]?.toUpperCase()
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display font-700 text-lg truncate">@{profile.username}</p>
          <p className="text-sm text-ink/50">ID {formatPublicId(profile.publicId)}</p>
          {email && <p className="text-sm text-ink/50 truncate">{email}</p>}
        </div>
        <button
          onClick={() => setProfileOpen(true)}
          className="shrink-0 rounded-card border border-line px-3.5 py-2 text-sm font-medium hover:border-ink/40"
        >
          Изменить
        </button>
      </section>

      <OfflineSection />

      <Group title="Помощь">
        <Row icon="message" label="Оставить отзыв" onClick={() => setFeedbackOpen(true)} />
        <Row icon="shield" label="Политика конфиденциальности" to="/privacy" />
        {admin && <Row icon="chart" label="Аналитика" to="/admin" />}
      </Group>

      <Group title="Аккаунт">
        <Row icon="logout" label="Выйти из аккаунта" onClick={() => setLogoutOpen(true)} />
        <Row
          icon="trash"
          label="Удалить аккаунт"
          hint="Навсегда удаляет ваши тетради, карточки и файлы"
          danger
          onClick={() => setDeleteOpen(true)}
        />
      </Group>

      {profileOpen && <ProfileModal profile={profile} onSaved={onProfileChange} onClose={() => setProfileOpen(false)} />}
      {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}
      {logoutOpen && (
        <ConfirmDialog
          title="Выйти из аккаунта?"
          text={
            pending > 0
              ? `На этом устройстве есть неотправленные правки (${pending}). Если выйти сейчас, они пропадут — сначала подключитесь к интернету.`
              : "Сохранённые для офлайна конспекты на этом устройстве будут стёрты. Всё остальное останется в аккаунте."
          }
          confirmLabel="Выйти"
          onConfirm={() => signOut()}
          onClose={() => setLogoutOpen(false)}
        />
      )}
      {deleteOpen && <DeleteAccountDialog username={profile.username} onClose={() => setDeleteOpen(false)} />}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h3 className="text-sm font-semibold text-ink/50 mb-2 px-1">{title}</h3>
      <div className="rounded-2xl bg-card border border-line divide-y divide-line overflow-hidden">{children}</div>
    </section>
  );
}

function Row({
  icon,
  label,
  hint,
  danger,
  to,
  onClick,
}: {
  icon: IconName;
  label: string;
  hint?: string;
  danger?: boolean;
  to?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span
        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
          danger ? "bg-coral/10 text-coral" : "bg-paper text-ink/70"
        }`}
      >
        <Icon name={icon} size={18} />
      </span>
      <span className="flex-1 min-w-0">
        <span className={`block text-sm font-medium ${danger ? "text-coral" : ""}`}>{label}</span>
        {hint && <span className="block text-xs text-ink/45 mt-0.5">{hint}</span>}
      </span>
      <Icon name="chevron" size={16} className="text-ink/30" />
    </>
  );
  const cls = "w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-paper/70 transition-colors";
  return to ? (
    <Link to={to} className={cls}>
      {content}
    </Link>
  ) : (
    <button onClick={onClick} className={cls}>
      {content}
    </button>
  );
}

// Работа без интернета: статус и кнопка «скачать всё на устройство»
function OfflineSection() {
  const online = useOnline();
  const pending = usePendingCount();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState("");

  async function downloadAll() {
    setResult("");
    setProgress({ done: 0, total: 0 });
    try {
      // Списки (они же попадают в офлайн-кэш при загрузке)
      const [mine, shared] = await Promise.all([getNotebooks(), getSharedWithMe().catch(() => [])]);
      await Promise.all([getFlashcardSets().catch(() => []), getGroups().catch(() => [])]);
      const notebooks = [...mine, ...shared.map((s) => s.notebook)];
      const pagesByNotebook = await Promise.all(notebooks.map((nb) => getPages(nb.id).catch(() => [])));
      const pageIds = pagesByNotebook.flat().map((p) => p.id);
      setProgress({ done: 0, total: pageIds.length });
      let done = 0;
      // Страницы — по 4 одновременно, чтобы не забивать сеть
      for (let i = 0; i < pageIds.length; i += 4) {
        await Promise.all(pageIds.slice(i, i + 4).map((id) => getPage(id).catch(() => undefined)));
        done = Math.min(pageIds.length, i + 4);
        setProgress({ done, total: pageIds.length });
      }
      setResult(`Готово: ${notebooks.length} тетрадей, ${pageIds.length} страниц доступны без интернета`);
    } catch (err: any) {
      setResult(err?.message ?? "Не получилось сохранить — попробуйте ещё раз");
    } finally {
      setProgress(null);
    }
  }

  return (
    <Group title="Без интернета">
      <div className="px-4 py-4 flex gap-3">
        <span
          className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
            online ? "bg-sage/15 text-sage" : "bg-highlight/30 text-ink"
          }`}
        >
          <Icon name={online ? "cloud" : "offline"} size={18} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{online ? "Вы онлайн" : "Нет подключения"}</p>
          <p className="text-xs text-ink/50 mt-0.5 leading-relaxed">
            Тетради, которые вы открывали, читаются и редактируются без интернета. Правки сохраняются на
            устройстве и отправляются сами, когда сеть вернётся.
            {pending > 0 && ` Сейчас ждут отправки: ${pending}.`}
          </p>
          <button
            onClick={downloadAll}
            disabled={!online || progress !== null}
            className="mt-3 rounded-card bg-ink text-white text-sm font-medium px-4 py-2 hover:bg-ink/90 disabled:opacity-40"
          >
            {progress
              ? progress.total
                ? `Сохраняем страницы: ${progress.done} из ${progress.total}`
                : "Собираем список…"
              : "Сохранить все тетради на устройство"}
          </button>
          {result && <p className="text-xs text-ink/60 mt-2">{result}</p>}
        </div>
      </div>
    </Group>
  );
}

const STEP_TEXT: Record<DeletionStep, string> = {
  collect: "Проверяем, какие файлы нужны группам…",
  files: "Удаляем ваши файлы…",
  account: "Удаляем аккаунт…",
  done: "Аккаунт удалён",
};

// Удаление аккаунта: объясняем последствия и просим ввести юзернейм — случайно не нажмёшь
function DeleteAccountDialog({ username, onClose }: { username: string; onClose: () => void }) {
  const online = useOnline();
  const [typed, setTyped] = useState("");
  const [step, setStep] = useState<DeletionStep | null>(null);
  const [error, setError] = useState("");
  const busy = step !== null && step !== "done";
  const matches = typed.trim().replace(/^@/, "").toLowerCase() === username.toLowerCase();

  async function handleDelete() {
    if (!matches || busy) return;
    setError("");
    try {
      await deleteMyAccount(setStep);
      // После выхода App сам покажет экран входа
    } catch (err: any) {
      setStep(null);
      setError(err?.message ?? "Не получилось удалить аккаунт. Попробуйте ещё раз.");
    }
  }

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-40 p-4" onClick={busy ? undefined : onClose}>
      <div className="bg-card rounded-card p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <span className="w-11 h-11 rounded-full bg-coral/10 text-coral flex items-center justify-center mb-4">
          <Icon name="trash" size={22} />
        </span>
        <h3 className="font-display font-800 text-xl mb-2">Удалить аккаунт навсегда?</h3>
        <ul className="text-sm text-ink/70 space-y-1.5 mb-4 list-disc pl-5">
          <li>Ваши тетради, страницы, флеш-карты, друзья и загруженные файлы удалятся без возможности восстановить.</li>
          <li>Группы, которые вы создали, перейдут к другому участнику. Если вы в группе одни, она удалится.</li>
          <li>Ваши записи в общих тетрадях групп и сообщения в чатах останутся у группы, без вашего имени.</li>
        </ul>
        <label className="text-xs text-ink/60 mb-1 block">
          Чтобы подтвердить, введите свой юзернейм: <span className="font-semibold text-ink">{username}</span>
        </label>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleDelete()}
          disabled={busy}
          autoFocus
          autoComplete="off"
          className="w-full rounded-card border border-line px-3 py-2.5 text-sm mb-3"
        />
        {!online && <p className="text-xs text-coral mb-3">Для удаления аккаунта нужен интернет.</p>}
        {step && <p className="text-xs text-ink/60 mb-3">{STEP_TEXT[step]}</p>}
        {error && <p className="text-xs text-coral mb-3">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="px-4 py-2 text-sm text-ink/60 hover:text-ink">
            Отмена
          </button>
          <button
            onClick={handleDelete}
            disabled={!matches || busy || !online}
            className="px-4 py-2 text-sm rounded-card bg-coral text-white font-medium hover:brightness-95 disabled:opacity-40"
          >
            {busy ? "Удаляем…" : "Удалить аккаунт"}
          </button>
        </div>
      </div>
    </div>
  );
}
