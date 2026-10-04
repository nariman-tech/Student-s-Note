import { useEffect, useMemo, useState } from "react";
import {
  getAdminStats,
  getAllFeedback,
  isAdmin,
  setFeedbackStatus,
  deleteFeedback,
  AdminStats,
  FeedbackItem,
  TrackedEvent,
} from "../lib/analytics";

// Страница «Аналитика» — только для администратора (проверяет и база: admin_stats отказывает остальным).
// Только числа: активность по дням, созданное, использование функций, отзывы.

const CHART_COLOR = "#6B6FD4"; // одна серия на график; проверен валидатором контраста на белом фоне

const EVENT_LABELS: Record<TrackedEvent, string> = {
  app_open: "Открыли приложение",
  search: "Поиск",
  pdf_export: "Скачали PDF",
  card_from_selection: "«В карточку» из конспекта",
  share_link_enabled: "Включили доступ по ссылке",
  group_notebook_created: "Создали тетрадь группы",
  drawing_attached: "Прикрепили рисунок",
  feedback_sent: "Отправили отзыв",
};

const RATING_EMOJI: Record<number, string> = { 1: "😞", 2: "😕", 3: "😐", 4: "🙂", 5: "😍" };
const CATEGORY_LABELS: Record<string, string> = { like: "👍 Нравится", bug: "🐞 Ошибка", idea: "💡 Идея", other: "💬 Другое" };

function formatDay(iso: string, withYear = false) {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: withYear ? "numeric" : undefined });
}

export default function AdminPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    isAdmin().then(setAllowed);
  }, []);

  useEffect(() => {
    if (!allowed) return;
    setStats(null);
    setError("");
    Promise.all([getAdminStats(days), getAllFeedback()])
      .then(([s, f]) => {
        setStats(s);
        setFeedback(f);
      })
      .catch((err) => setError(err?.message ?? "Не получилось загрузить аналитику"));
  }, [allowed, days]);

  if (allowed === null) return <div className="p-8 text-sm text-ink/40">Загрузка…</div>;
  if (!allowed) {
    return (
      <div className="p-4 md:p-8 max-w-2xl mx-auto">
        <h2 className="text-2xl font-display font-800 mb-2">Аналитика</h2>
        <p className="text-sm text-ink/60">Эта страница доступна только администратору приложения.</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-display font-800">Аналитика</h2>
          <p className="text-sm text-ink/50 mt-1">Только числа — содержимое конспектов и сообщений здесь не видно</p>
        </div>
        <div className="flex rounded-card bg-card border border-line p-1" role="radiogroup" aria-label="Период">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              role="radio"
              aria-checked={days === d}
              onClick={() => setDays(d)}
              className={`text-sm px-3 py-1.5 rounded-card ${days === d ? "bg-ink text-white font-medium" : "text-ink/60 hover:text-ink"}`}
            >
              {d} дней
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-coral mb-4">{error}</p>}
      {!stats ? (
        !error && <p className="text-sm text-ink/40">Загрузка…</p>
      ) : (
        <>
          {/* Главное — числа, а не графики */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <StatTile label="Активны сегодня" value={stats.active.today} />
            <StatTile label="Активны за 7 дней" value={stats.active.week} />
            <StatTile label="Активны за 30 дней" value={stats.active.month} />
            <StatTile label="Всего пользователей" value={stats.totals.users} />
          </div>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-8">
            <StatTile small label="Тетради" value={stats.totals.notebooks} hint={`из них групп: ${stats.totals.group_notebooks}`} />
            <StatTile small label="Страницы" value={stats.totals.pages} />
            <StatTile small label="Карточки" value={stats.totals.flashcards} hint={`модулей: ${stats.totals.flashcard_sets}`} />
            <StatTile small label="Группы" value={stats.totals.groups} />
            <StatTile small label="Сообщения" value={stats.totals.messages} />
            <StatTile small label="Дружбы" value={stats.totals.friendships} />
          </div>

          <h3 className="font-display font-700 mb-3">По дням за {days} дней</h3>
          <div className="grid md:grid-cols-2 gap-4 mb-8">
            <BarChart title="Активные пользователи" data={stats.daily.map((d) => ({ day: d.day, value: d.active }))} />
            <BarChart title="Новые пользователи" data={stats.daily.map((d) => ({ day: d.day, value: d.new_users }))} />
            <BarChart title="Созданные страницы" data={stats.daily.map((d) => ({ day: d.day, value: d.pages }))} />
            <BarChart title="Сообщения в чатах" data={stats.daily.map((d) => ({ day: d.day, value: d.messages }))} />
          </div>

          <h3 className="font-display font-700 mb-3">Какими функциями пользуются (за {days} дней)</h3>
          <FeatureUsage events={stats.events} />

          <FeedbackList
            items={feedback}
            avgRating={stats.totals.avg_rating}
            onToggle={async (item) => {
              const status = item.status === "new" ? "done" : "new";
              await setFeedbackStatus(item.id, status);
              setFeedback((list) => list.map((f) => (f.id === item.id ? { ...f, status } : f)));
            }}
            onDelete={async (item) => {
              await deleteFeedback(item.id);
              setFeedback((list) => list.filter((f) => f.id !== item.id));
            }}
          />
        </>
      )}
    </div>
  );
}

function StatTile({ label, value, hint, small }: { label: string; value: number; hint?: string; small?: boolean }) {
  return (
    <div className="rounded-card border border-line bg-card p-4">
      <p className="text-xs text-ink/50">{label}</p>
      <p className={`font-display font-800 text-ink ${small ? "text-xl" : "text-3xl"} mt-1 tabular-nums`}>
        {value.toLocaleString("ru-RU")}
      </p>
      {hint && <p className="text-[11px] text-ink/40 mt-0.5">{hint}</p>}
    </div>
  );
}

// Столбчатый график по дням: одна серия (название — в заголовке, легенда не нужна),
// подсказка при наведении, рядом — переключатель «таблицей» для тех, кому график неудобен
function BarChart({ title, data }: { title: string; data: { day: string; value: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const total = useMemo(() => data.reduce((sum, d) => sum + d.value, 0), [data]);
  const max = Math.max(1, ...data.map((d) => d.value));

  const W = 600;
  const H = 150;
  const top = 10;
  const bottom = 22;
  const plotH = H - top - bottom;
  const slot = W / Math.max(1, data.length);
  const gap = 2; // промежуток между столбцами цвета фона
  const barW = Math.max(2, Math.min(18, slot - gap));
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const labelIdx = data.length > 0 ? [0, Math.floor((data.length - 1) / 2), data.length - 1] : [];

  return (
    <figure className="rounded-card border border-line bg-card p-4 relative">
      <figcaption className="flex items-baseline justify-between gap-2 mb-2">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-ink/50">
          всего: <span className="text-ink font-medium tabular-nums">{total.toLocaleString("ru-RU")}</span>
          <button onClick={() => setAsTable((v) => !v)} className="ml-3 underline hover:text-ink">
            {asTable ? "графиком" : "таблицей"}
          </button>
        </span>
      </figcaption>

      {asTable ? (
        <div className="max-h-[150px] overflow-y-auto text-xs">
          <table className="w-full">
            <thead>
              <tr className="text-ink/50 text-left">
                <th className="font-normal py-1">День</th>
                <th className="font-normal py-1 text-right">Значение</th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((d) => (
                <tr key={d.day} className="border-t border-line">
                  <td className="py-1">{formatDay(d.day)}</td>
                  <td className="py-1 text-right tabular-nums">{d.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`${title} по дням, всего ${total}`}>
            {/* Сетка — едва заметная: максимум и ноль */}
            <line x1={0} x2={W} y1={y(max)} y2={y(max)} stroke="#DCE0E8" strokeWidth={1} strokeDasharray="3 3" />
            <line x1={0} x2={W} y1={top + plotH} y2={top + plotH} stroke="#DCE0E8" strokeWidth={1} />
            <text x={2} y={y(max) - 3} fontSize={10} fill="rgba(27,35,64,.45)">
              {max}
            </text>
            {data.map((d, i) => {
              const x = i * slot + (slot - barW) / 2;
              const h = Math.max(0, top + plotH - y(d.value));
              const r = Math.min(4, barW / 2, h); // скругление только сверху, низ стоит на оси
              return (
                <g key={d.day}>
                  {h > 0 && (
                    <path
                      d={`M${x},${top + plotH} V${top + plotH - h + r} Q${x},${top + plotH - h} ${x + r},${top + plotH - h} H${x + barW - r} Q${x + barW},${top + plotH - h} ${x + barW},${top + plotH - h + r} V${top + plotH} Z`}
                      fill={CHART_COLOR}
                      opacity={hover === null || hover === i ? 1 : 0.45}
                    />
                  )}
                  {/* Зона наведения — на всю высоту и ширину дня, больше самого столбца */}
                  <rect x={i * slot} y={0} width={slot} height={top + plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
                </g>
              );
            })}
            {labelIdx.map((i) => (
              <text
                key={i}
                x={i * slot + slot / 2}
                y={H - 6}
                fontSize={10}
                fill="rgba(27,35,64,.5)"
                textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}
              >
                {formatDay(data[i].day)}
              </text>
            ))}
          </svg>
          {hover !== null && data[hover] && (
            <div
              className="absolute pointer-events-none -translate-x-1/2 -translate-y-full bg-ink text-white text-xs rounded-card px-2 py-1 whitespace-nowrap"
              style={{ left: `${((hover + 0.5) / data.length) * 100}%`, top: 0 }}
            >
              {formatDay(data[hover].day)}: <span className="font-semibold">{data[hover].value}</span>
            </div>
          )}
        </div>
      )}
    </figure>
  );
}

// Использование функций — горизонтальные полосы, отсортированы по убыванию, числа подписаны
function FeatureUsage({ events }: { events: AdminStats["events"] }) {
  const rows = (Object.keys(EVENT_LABELS) as TrackedEvent[])
    .map((key) => ({ key, label: EVENT_LABELS[key], value: events[key] ?? 0 }))
    .sort((a, b) => b.value - a.value);
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="rounded-card border border-line bg-card p-4 mb-8 flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-[minmax(0,12rem)_1fr_3rem] items-center gap-3 text-sm">
          <span className="truncate text-ink/80">{r.label}</span>
          <div className="h-3 rounded-full bg-paper overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, backgroundColor: CHART_COLOR }} />
          </div>
          <span className="text-right tabular-nums text-ink">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function FeedbackList({
  items,
  avgRating,
  onToggle,
  onDelete,
}: {
  items: FeedbackItem[];
  avgRating: number | null;
  onToggle: (item: FeedbackItem) => Promise<void>;
  onDelete: (item: FeedbackItem) => Promise<void>; // спам или тестовые отзывы
}) {
  const [filter, setFilter] = useState<"new" | "all">("new");
  const shown = filter === "new" ? items.filter((f) => f.status === "new") : items;
  const newCount = items.filter((f) => f.status === "new").length;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h3 className="font-display font-700">
          Отзывы{" "}
          <span className="text-sm font-normal text-ink/50">
            · средняя оценка {avgRating !== null ? `${avgRating} из 5` : "—"}
          </span>
        </h3>
        <div className="flex gap-1 text-sm">
          <button
            onClick={() => setFilter("new")}
            className={`px-3 py-1 rounded-card ${filter === "new" ? "bg-ink text-white" : "text-ink/60 hover:text-ink"}`}
          >
            Новые ({newCount})
          </button>
          <button
            onClick={() => setFilter("all")}
            className={`px-3 py-1 rounded-card ${filter === "all" ? "bg-ink text-white" : "text-ink/60 hover:text-ink"}`}
          >
            Все ({items.length})
          </button>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-ink/50">{filter === "new" ? "Новых отзывов нет." : "Отзывов пока нет."}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((f) => (
            <div key={f.id} className={`rounded-card border border-line bg-card p-4 ${f.status === "done" ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink/50 mb-1">
                {f.rating && <span className="text-lg leading-none">{RATING_EMOJI[f.rating]}</span>}
                <span className="text-ink/70">{CATEGORY_LABELS[f.category]}</span>
                <span>· {f.username ? `@${f.username}` : "удалённый пользователь"}</span>
                <span>· {formatDay(f.createdAt, true)}</span>
                {f.page && <span>· страница {f.page}</span>}
                <button onClick={() => onToggle(f)} className="ml-auto underline hover:text-ink">
                  {f.status === "new" ? "✓ Разобрано" : "Вернуть в новые"}
                </button>
                <button onClick={() => onDelete(f)} className="hover:text-coral" aria-label="Удалить отзыв" title="Удалить (спам)">
                  🗑
                </button>
              </div>
              {f.message && <p className="text-sm whitespace-pre-wrap break-words">{f.message}</p>}
              {f.category === "bug" && f.userAgent && <p className="text-[11px] text-ink/35 mt-1 break-all">{f.userAgent}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
