import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { PublicProfile } from "../types";
import { formatPublicId, getIncomingRequestCount, FRIEND_REQUESTS_CHANGED } from "../lib/store";
import { FeedbackModal } from "./Feedback";
import Icon, { IconName } from "./Icon";
import { OfflineBadge } from "./OfflineStatus";
import { isAdmin } from "../lib/analytics";

export const NAV_LINKS: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: "/", label: "Тетради", icon: "notebooks", end: true },
  { to: "/flashcards", label: "Флеш-карты", icon: "cards" },
  { to: "/groups", label: "Группы", icon: "groups" },
  { to: "/friends", label: "Друзья", icon: "friends" },
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

function Avatar({ profile, size }: { profile: PublicProfile; size: "sm" | "md" }) {
  const box = size === "md" ? "w-10 h-10 text-sm" : "w-8 h-8 text-sm";
  return (
    <span
      className={`${box} rounded-full bg-highlight flex items-center justify-center text-ink font-semibold overflow-hidden shrink-0 ring-2 ring-white/15`}
    >
      {profile.avatarUrl ? (
        <img src={profile.avatarUrl} alt="" className="w-full h-full object-cover" />
      ) : (
        profile.username[0]?.toUpperCase()
      )}
    </span>
  );
}

// Пункт меню в боковой панели. Активный отмечен жёлтой закладкой слева — как ленточка в тетради
function SideLink({ to, end, icon, label, children }: { to: string; end?: boolean; icon: IconName; label: string; children?: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `relative flex items-center gap-3 px-3 py-2.5 rounded-card text-sm font-medium transition-colors ${
          isActive ? "bg-white/[0.08] text-white" : "text-white/55 hover:text-white hover:bg-white/[0.04]"
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute -left-4 top-1.5 bottom-1.5 w-1.5 rounded-r-full bg-highlight" aria-hidden />}
          <Icon name={icon} size={19} className={isActive ? "text-highlight" : ""} />
          {label}
          {children}
        </>
      )}
    </NavLink>
  );
}

// Боковая панель — на компьютере и планшете. На телефоне вместо неё MobileNav (верхняя
// полоса + нижнее меню с вкладками), см. ниже
export default function Sidebar({ profile }: { profile: PublicProfile }) {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const pendingRequests = usePendingRequests();
  const admin = useIsAdmin();

  return (
    <aside className="hidden md:flex w-64 shrink-0 bg-sidebar text-white flex-col py-6 px-4 print:hidden sticky top-0 h-screen">
      <div className="flex items-center gap-2.5 px-2 mb-8">
        <img src="/icons/icon-192.png" alt="" className="w-8 h-8 rounded-lg" />
        <span className="font-display font-800 text-lg tracking-tight">Lectiva</span>
      </div>

      <nav className="flex flex-col gap-1">
        {NAV_LINKS.map((link) => (
          <SideLink key={link.to} {...link}>
            {link.to === "/friends" && <RequestsBadge count={pendingRequests} className="ml-auto" />}
          </SideLink>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-1">
        <OfflineBadge />
        {admin && <SideLink to="/admin" icon="chart" label="Аналитика" />}
        <button
          onClick={() => setFeedbackOpen(true)}
          className="flex items-center gap-3 px-3 py-2.5 rounded-card text-sm font-medium text-white/55 hover:text-white hover:bg-white/[0.04]"
        >
          <Icon name="message" size={19} />
          Отзыв
        </button>
        <SideLink to="/settings" icon="settings" label="Настройки" />
      </div>

      {/* Профиль внизу — ведёт в настройки */}
      <div className="mt-4 pt-3 border-t border-white/10" />
      <NavLink
        to="/settings"
        className="flex items-center gap-3 px-2 py-2 rounded-card hover:bg-white/[0.04]"
        title="Настройки"
      >
        <Avatar profile={profile} size="md" />
        <div className="min-w-0">
          <p className="text-sm text-white truncate">@{profile.username}</p>
          <p className="text-xs text-white/40">ID {formatPublicId(profile.publicId)}</p>
        </div>
      </NavLink>

      {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}
    </aside>
  );
}

// Телефон: сверху — название, значок «без сети» и аватарка (ведёт в настройки),
// снизу — вкладки как в обычных приложениях
export function MobileNav({ profile }: { profile: PublicProfile }) {
  const pendingRequests = usePendingRequests();

  return (
    <>
      <header
        className="md:hidden sticky top-0 z-20 bg-sidebar text-white flex items-center justify-between px-4 h-14 print:hidden"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <span className="flex items-center gap-2 font-display font-800 text-lg">
          <img src="/icons/icon-192.png" alt="" className="w-7 h-7 rounded-md" />
          Lectiva
        </span>
        <div className="flex items-center gap-2">
          <OfflineBadge compact />
          <NavLink to="/settings" className="flex items-center gap-2 rounded-full p-0.5 hover:bg-white/5" aria-label="Настройки">
            <Avatar profile={profile} size="sm" />
          </NavLink>
        </div>
      </header>

      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-card/95 backdrop-blur border-t border-line grid grid-cols-4 print:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {NAV_LINKS.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) =>
              `relative flex flex-col items-center justify-center gap-1 h-16 text-[11px] font-semibold ${
                isActive ? "text-ink" : "text-ink/40"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={`flex items-center justify-center w-12 h-7 rounded-full transition-colors ${
                    isActive ? "bg-highlight/70" : ""
                  }`}
                >
                  <Icon name={link.icon} size={20} />
                </span>
                {link.label}
                {link.to === "/friends" && <RequestsBadge count={pendingRequests} className="absolute top-1 left-1/2 ml-3" />}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
