import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { PublicProfile } from "../types";
import { formatPublicId, getIncomingRequestCount, FRIEND_REQUESTS_CHANGED } from "../lib/store";
import { signOut } from "../lib/auth";
import ProfileModal from "./ProfileModal";
import { FeedbackModal } from "./Feedback";
import { isAdmin } from "../lib/analytics";

export const NAV_LINKS = [
  { to: "/", label: "Тетради", icon: "📚", end: true },
  { to: "/flashcards", label: "Флеш-карты", icon: "🗂️" },
  { to: "/groups", label: "Группы", icon: "🎓" },
  { to: "/friends", label: "Друзья", icon: "👥" },
];

// Счётчик заявок в друзья (общий для боковой панели и нижнего меню на телефоне): при переходе
// между страницами, при возвращении в окно, раз в 30 секунд и сразу после ответа на заявку
export function usePendingRequests(): number {
  const [pendingRequests, setPendingRequests] = useState(0);
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      getIncomingRequestCount()
        .then((n) => !cancelled && setPendingRequests(n))
        .catch(() => {});
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    window.addEventListener(FRIEND_REQUESTS_CHANGED, refresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(FRIEND_REQUESTS_CHANGED, refresh);
    };
  }, [location.pathname]);

  return pendingRequests;
}

// Администратор видит пункт «Аналитика» (проверку всё равно делает база)
export function useIsAdmin(): boolean {
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    isAdmin().then(setAdmin);
  }, []);
  return admin;
}

export function RequestsBadge({ count, className = "" }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={`min-w-5 h-5 px-1.5 rounded-full bg-coral text-white text-[11px] font-semibold flex items-center justify-center ${className}`}
      aria-label={`Заявок в друзья: ${count}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

// Боковая панель — на компьютере и планшете. На телефоне вместо неё MobileNav (верхняя
// полоса + нижнее меню с вкладками), см. ниже
export default function Sidebar({
  profile,
  onProfileChange,
}: {
  profile: PublicProfile;
  onProfileChange: (profile: PublicProfile) => void;
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const pendingRequests = usePendingRequests();
  const admin = useIsAdmin();

  return (
    <aside className="hidden md:flex w-60 shrink-0 bg-sidebar text-white flex-col py-6 px-4 print:hidden sticky top-0 h-screen">
      <button
        onClick={() => setProfileOpen(true)}
        className="px-2 py-1.5 mb-8 -mx-0 flex items-center gap-3 rounded-card text-left hover:bg-white/5"
        title="Настройки профиля"
      >
        <div className="w-9 h-9 rounded-full bg-highlight flex items-center justify-center text-ink text-sm font-semibold overflow-hidden shrink-0">
          {profile.avatarUrl ? (
            <img src={profile.avatarUrl} alt={profile.username} className="w-full h-full object-cover" />
          ) : (
            profile.username[0]?.toUpperCase()
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm text-white/90 truncate">@{profile.username}</p>
          <p className="text-xs text-white/40">ID {formatPublicId(profile.publicId)}</p>
        </div>
        <span className="ml-auto text-white/30 text-xs" aria-hidden>
          ⚙️
        </span>
      </button>

      <nav className="flex flex-col gap-1">
        {NAV_LINKS.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-card text-sm font-medium transition-colors ${
                isActive ? "bg-white/10 text-white" : "text-white/60 hover:text-white hover:bg-white/5"
              }`
            }
          >
            <span aria-hidden>{link.icon}</span>
            {link.label}
            {link.to === "/friends" && <RequestsBadge count={pendingRequests} className="ml-auto" />}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-1">
        {admin && (
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-card text-sm font-medium ${
                isActive ? "bg-white/10 text-white" : "text-white/50 hover:text-white hover:bg-white/5"
              }`
            }
          >
            <span aria-hidden>📊</span>
            Аналитика
          </NavLink>
        )}
        <button
          onClick={() => setFeedbackOpen(true)}
          className="flex items-center gap-3 px-3 py-2.5 rounded-card text-sm font-medium text-white/50 hover:text-white hover:bg-white/5"
        >
          <span aria-hidden>💬</span>
          Отзыв
        </button>
      </div>

      {/* После выхода App.tsx сам покажет экран входа — он следит за сессией через onAuthStateChange */}
      <button
        onClick={() => signOut()}
        className="flex items-center gap-3 px-3 py-2.5 rounded-card text-sm font-medium text-white/50 hover:text-white hover:bg-white/5"
      >
        <span aria-hidden>🚪</span>
        Выйти
      </button>

      {profileOpen && <ProfileModal profile={profile} onSaved={onProfileChange} onClose={() => setProfileOpen(false)} />}
      {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}
    </aside>
  );
}

// Телефон: сверху — название и аватарка (профиль, выход), снизу — вкладки как в обычных приложениях
export function MobileNav({
  profile,
  onProfileChange,
}: {
  profile: PublicProfile;
  onProfileChange: (profile: PublicProfile) => void;
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  const pendingRequests = usePendingRequests();

  return (
    <>
      <header className="md:hidden sticky top-0 z-20 bg-sidebar text-white flex items-center justify-between px-4 h-14 print:hidden">
        <span className="font-display font-800">📓 Тетрадь</span>
        <button
          onClick={() => setProfileOpen(true)}
          className="flex items-center gap-2 rounded-card px-1.5 py-1 hover:bg-white/5"
          aria-label="Профиль"
        >
          <span className="text-sm text-white/80 max-w-[140px] truncate">@{profile.username}</span>
          <span className="w-8 h-8 rounded-full bg-highlight flex items-center justify-center text-ink text-sm font-semibold overflow-hidden">
            {profile.avatarUrl ? (
              <img src={profile.avatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              profile.username[0]?.toUpperCase()
            )}
          </span>
        </button>
      </header>

      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-card border-t border-line grid grid-cols-4 print:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {NAV_LINKS.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) =>
              `relative flex flex-col items-center justify-center gap-0.5 h-16 text-[11px] font-medium ${
                isActive ? "text-ink" : "text-ink/45"
              }`
            }
          >
            <span className="text-xl leading-none" aria-hidden>
              {link.icon}
            </span>
            {link.label}
            {link.to === "/friends" && <RequestsBadge count={pendingRequests} className="absolute top-1.5 left-1/2 ml-2" />}
          </NavLink>
        ))}
      </nav>

      {profileOpen && <ProfileModal profile={profile} onSaved={onProfileChange} onClose={() => setProfileOpen(false)} />}
    </>
  );
}
