import { lazy, Suspense, useEffect, useState } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import Sidebar, { MobileNav } from "./components/Sidebar";
import Notebooks from "./pages/Notebooks";
import Login from "./pages/Login";

// Страницы загружаются, только когда на них переходят — так первое открытие приложения быстрее.
// Сразу грузим только экран входа и главную (список тетрадей) — их видят первыми.
const NotebookEditor = lazy(() => import("./pages/NotebookEditor"));
const Flashcards = lazy(() => import("./pages/Flashcards"));
const Groups = lazy(() => import("./pages/Groups"));
const JoinByLink = lazy(() => import("./pages/Groups").then((m) => ({ default: m.JoinByLink })));
const GroupPage = lazy(() => import("./pages/GroupPage"));
const Friends = lazy(() => import("./pages/Friends"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const PublicNotebookView = lazy(() => import("./pages/PublicView").then((m) => ({ default: m.PublicNotebookView })));
const PublicFlashcardsView = lazy(() => import("./pages/PublicView").then((m) => ({ default: m.PublicFlashcardsView })));

const pageLoading = <div className="p-8 text-sm text-ink/40">Загрузка…</div>;
const screenLoading = <div className="min-h-screen flex items-center justify-center text-sm text-ink/40">Загрузка…</div>;
import { getSession, onAuthStateChange, ensureProfile } from "./lib/auth";
import { getMyPublicProfile } from "./lib/store";
import { track } from "./lib/analytics";
import { FeedbackPrompt } from "./components/Feedback";

// «Открыл приложение» — один раз за запуск (для счёта активных пользователей по дням)
let appOpenTracked = false;
import type { Session } from "@supabase/supabase-js";
import { PublicProfile } from "./types";

function AppShell({ profile, onProfileChange }: { profile: PublicProfile; onProfileChange: (p: PublicProfile) => void }) {
  useEffect(() => {
    if (appOpenTracked) return;
    appOpenTracked = true;
    track("app_open");
  }, []);

  return (
    <div className="flex min-h-screen">
      <Sidebar profile={profile} onProfileChange={onProfileChange} />
      <div className="flex-1 min-w-0 flex flex-col">
      <MobileNav profile={profile} onProfileChange={onProfileChange} />
      {/* pb-20 на телефоне — место под нижнее меню */}
      <main className="flex-1 overflow-y-auto pb-20 md:pb-0 print:pb-0">
        <Suspense fallback={pageLoading}>
        <Routes>
          <Route path="/" element={<Notebooks />} />
          <Route path="/notebook/:id" element={<NotebookEditor />} />
          <Route path="/flashcards" element={<Flashcards />} />
          <Route path="/groups" element={<Groups />} />
          <Route path="/groups/:id" element={<GroupPage />} />
          <Route path="/join/:code" element={<JoinByLink />} />
          <Route path="/friends" element={<Friends />} />
          <Route path="/admin" element={<AdminPage />} />
        </Routes>
        </Suspense>
      </main>
      </div>
      <FeedbackPrompt />
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined); // undefined = ещё проверяем
  // undefined = ещё проверяем, null = проверили — профиля нет (нужен онбординг)
  const [profile, setProfile] = useState<PublicProfile | null | undefined>(undefined);
  const [recovering, setRecovering] = useState(false); // открыли ссылку «сбросить пароль»
  const location = useLocation();

  useEffect(() => {
    getSession().then((s) => setSession(s));
    const unsubscribe = onAuthStateChange((s, isRecovery) => {
      setSession(s);
      if (isRecovery) setRecovering(true);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!session?.user) {
      setProfile(undefined);
      return;
    }
    (async () => {
      // При первом входе создаём строку приватного профиля — дальше всё (тетради, заметки) ссылается на неё
      await ensureProfile(session.user.id, session.user.email ?? undefined).catch(console.error);
      const pub = await getMyPublicProfile().catch(() => undefined);
      setProfile(pub ?? null);
    })();
  }, [session?.user?.id]);

  // Ссылки из мессенджеров (/s/n/…, /s/f/…) открываются и без входа в аккаунт
  if (location.pathname.startsWith("/s/")) {
    return (
      <Suspense fallback={screenLoading}>
      <Routes>
        <Route path="/s/n/:token" element={<PublicNotebookView loggedIn={!!session} />} />
        <Route path="/s/f/:token" element={<PublicFlashcardsView loggedIn={!!session} />} />
      </Routes>
      </Suspense>
    );
  }

  if (session === undefined) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-ink/40">Загрузка…</div>;
  }
  if (!session) {
    return <Login />;
  }
  if (recovering) {
    return (
      <Suspense fallback={screenLoading}>
        <ResetPassword onDone={() => setRecovering(false)} />
      </Suspense>
    );
  }
  if (profile === undefined) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-ink/40">Загрузка…</div>;
  }
  if (profile === null) {
    return (
      <Suspense fallback={screenLoading}>
        <Onboarding onDone={setProfile} />
      </Suspense>
    );
  }

  return <AppShell profile={profile} onProfileChange={setProfile} />;
}
