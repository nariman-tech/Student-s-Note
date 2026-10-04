import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getPublicNotebook, getPublicFlashcardSet, PublicNotebook, PublicFlashcardSet } from "../lib/links";
import { sanitizeNoteHtml } from "../lib/sanitize";
import { isUploadedFileUrl } from "../lib/upload";
import { exportToPdf } from "../lib/pdf";
import { StudySession } from "./Flashcards";

// Страница, которая открывается по ссылке из мессенджера — работает и без входа в аккаунт.
// /s/n/<token> — тетрадь (только чтение), /s/f/<token> — модуль флеш-карт (изучение)

function Shell({ children, loggedIn }: { children: React.ReactNode; loggedIn: boolean }) {
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line bg-card print:hidden">
        <div className="max-w-3xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link to="/" className="font-display font-800 text-lg">
            📓 Тетрадь
          </Link>
          <Link to="/" className="text-sm rounded-card bg-ink text-white px-4 py-2 font-medium hover:bg-ink/90">
            {loggedIn ? "Мои тетради" : "Войти или создать аккаунт"}
          </Link>
        </div>
      </header>
      <div className="max-w-3xl mx-auto px-6 py-8">{children}</div>
    </div>
  );
}

function NotAvailable({ message }: { message: string }) {
  return (
    <div className="text-center py-16">
      <p className="text-3xl mb-3">🔒</p>
      <p className="font-display font-700 mb-1">{message}</p>
      <p className="text-sm text-ink/50">Возможно, владелец выключил доступ по ссылке или удалил её.</p>
    </div>
  );
}

export function PublicNotebookView({ loggedIn }: { loggedIn: boolean }) {
  const { token } = useParams();
  const [notebook, setNotebook] = useState<PublicNotebook | null | undefined>(undefined);

  useEffect(() => {
    if (!token) return;
    getPublicNotebook(token)
      .then(setNotebook)
      .catch(() => setNotebook(null));
  }, [token]);

  if (notebook === undefined) return <Shell loggedIn={loggedIn}><p className="text-sm text-ink/40">Загрузка…</p></Shell>;
  if (notebook === null) return <Shell loggedIn={loggedIn}><NotAvailable message="Тетрадь недоступна по этой ссылке" /></Shell>;

  return (
    <Shell loggedIn={loggedIn}>
      {notebook.coverImageUrl && isUploadedFileUrl(notebook.coverImageUrl) && (
        <img src={notebook.coverImageUrl} alt="Обложка" className="w-full h-40 object-cover rounded-card border border-line mb-4 print:hidden" />
      )}
      <div className="flex items-center justify-between gap-4 mb-1">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-2xl">{notebook.coverImageUrl ? "📓" : notebook.iconEmoji}</span>
          <h1 className="text-xl font-display font-800 truncate">{notebook.title}</h1>
        </div>
        <button
          onClick={() => exportToPdf(notebook.title)}
          className="text-sm rounded-card border border-line px-3 py-2 hover:border-ink/40 shrink-0 print:hidden"
          title="Скачать конспект в PDF (в окне печати выберите «Сохранить как PDF»)"
        >
          ⬇️ PDF
        </button>
      </div>
      {notebook.ownerUsername && <p className="text-xs text-ink/40 mb-6 print:hidden">Конспект @{notebook.ownerUsername} · только чтение</p>}

      {/* Оглавление — если страниц несколько */}
      {notebook.pages.length > 1 && (
        <nav className="mb-6 rounded-card border border-line bg-card p-4 print:hidden" aria-label="Страницы тетради">
          <p className="text-xs font-medium text-ink/40 mb-2">Страницы</p>
          <ol className="list-decimal list-inside text-sm space-y-1">
            {notebook.pages.map((p) => (
              <li key={p.id}>
                <a href={`#page-${p.id}`} className="hover:underline">
                  {p.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}

      {notebook.pages.length === 0 && <p className="text-sm text-ink/50">В тетради пока нет страниц.</p>}

      {notebook.pages.map((p, i) => {
        const images = p.attachments.filter((a) => a.type === "image" && isUploadedFileUrl(a.url));
        return (
          <section key={p.id} id={`page-${p.id}`} className={`mb-8 scroll-mt-4 ${i > 0 ? "print:break-before-page" : ""}`}>
            <h2 className="text-lg font-display font-700 mb-2">{p.title}</h2>
            <div
              className="rounded-card border border-line bg-card p-4 text-sm leading-relaxed min-h-[120px] [&_[data-action]]:hidden print:border-0 print:p-0"
              // Чужой HTML — только после очистки (см. sanitize.ts)
              dangerouslySetInnerHTML={{ __html: sanitizeNoteHtml(p.content) }}
            />
            {images.length > 0 && (
              <div className="mt-3 flex flex-col gap-3">
                {images.map((a) => (
                  <img key={a.id} src={a.url} alt={a.name} className="w-full max-h-[420px] object-contain bg-paper rounded-card border border-line" />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </Shell>
  );
}

export function PublicFlashcardsView({ loggedIn }: { loggedIn: boolean }) {
  const { token } = useParams();
  const [set, setSet] = useState<PublicFlashcardSet | null | undefined>(undefined);

  useEffect(() => {
    if (!token) return;
    getPublicFlashcardSet(token)
      .then(setSet)
      .catch(() => setSet(null));
  }, [token]);

  if (set === undefined) return <Shell loggedIn={loggedIn}><p className="text-sm text-ink/40">Загрузка…</p></Shell>;
  if (set === null) return <Shell loggedIn={loggedIn}><NotAvailable message="Модуль флеш-карт недоступен по этой ссылке" /></Shell>;

  return (
    <Shell loggedIn={loggedIn}>
      <StudySession
        set={{ id: token!, title: set.title, color: set.color, cards: set.cards }}
        ownerUsername={set.ownerUsername ?? "друга"}
      />
    </Shell>
  );
}
