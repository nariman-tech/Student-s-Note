import { useEffect, useState } from "react";
import { sendFeedback, FeedbackCategory } from "../lib/analytics";

const RATINGS = [
  { value: 1, emoji: "😞", label: "Плохо" },
  { value: 2, emoji: "😕", label: "Так себе" },
  { value: 3, emoji: "😐", label: "Нормально" },
  { value: 4, emoji: "🙂", label: "Хорошо" },
  { value: 5, emoji: "😍", label: "Отлично" },
];

const CATEGORIES: { value: FeedbackCategory; label: string }[] = [
  { value: "like", label: "👍 Нравится" },
  { value: "bug", label: "🐞 Нашёл ошибку" },
  { value: "idea", label: "💡 Идея" },
  { value: "other", label: "💬 Другое" },
];

const PLACEHOLDERS: Record<FeedbackCategory, string> = {
  like: "Что особенно нравится?",
  bug: "Что случилось и что вы делали перед этим? Чем подробнее, тем быстрее исправим",
  idea: "Чего не хватает? Что бы вы добавили?",
  other: "Напишите, что думаете",
};

// Окно «Отзыв»: оценка смайликом + тип + текст
export function FeedbackModal({ initialRating, onClose }: { initialRating?: number; onClose: () => void }) {
  const [rating, setRating] = useState<number | undefined>(initialRating);
  const [category, setCategory] = useState<FeedbackCategory>(initialRating && initialRating <= 2 ? "bug" : "like");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const canSend = !sending && (rating !== undefined || message.trim().length > 0);

  async function handleSend() {
    if (!canSend) return;
    setSending(true);
    setError("");
    try {
      await sendFeedback({ rating, category, message });
      markFeedbackGiven();
      setSent(true);
    } catch (err: any) {
      setError(err?.message ?? "Не получилось отправить отзыв");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50 p-4 text-ink" onClick={onClose}>
      <div className="bg-card rounded-card p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        {sent ? (
          <div className="text-center py-4">
            <p className="text-3xl mb-2">💛</p>
            <h3 className="font-display font-700 mb-1">Спасибо за отзыв!</h3>
            <p className="text-sm text-ink/50 mb-5">Мы читаем каждый — так приложение становится лучше.</p>
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-card bg-ink text-white hover:bg-ink/90">
              Закрыть
            </button>
          </div>
        ) : (
          <>
            <h3 className="font-display font-700 mb-1">Как вам «Тетрадь»?</h3>
            <p className="text-xs text-ink/50 mb-4">Оценка и пара слов очень помогут</p>

            <div className="flex justify-between mb-4" role="radiogroup" aria-label="Оценка">
              {RATINGS.map((r) => (
                <button
                  key={r.value}
                  role="radio"
                  aria-checked={rating === r.value}
                  aria-label={r.label}
                  title={r.label}
                  onClick={() => setRating(r.value)}
                  className={`flex flex-col items-center gap-0.5 rounded-card px-2.5 py-2 text-2xl transition-transform ${
                    rating === r.value ? "bg-highlight/40 scale-110" : "hover:bg-paper"
                  }`}
                >
                  {r.emoji}
                  <span className="text-[10px] text-ink/50">{r.label}</span>
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-1.5 mb-3">
              {CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setCategory(c.value)}
                  aria-pressed={category === c.value}
                  className={`text-xs rounded-full px-3 py-1.5 border ${
                    category === c.value ? "bg-ink text-white border-ink" : "border-line hover:border-ink/40"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={2000}
              rows={4}
              placeholder={PLACEHOLDERS[category]}
              aria-label="Текст отзыва"
              className="w-full rounded-card border border-line px-3 py-2 text-sm resize-none"
            />
            {error && <p className="text-xs text-coral mt-2">{error}</p>}

            <div className="flex justify-end gap-2 mt-4">
              <button onClick={onClose} className="px-4 py-2 text-sm text-ink/60 hover:text-ink">
                Отмена
              </button>
              <button
                onClick={handleSend}
                disabled={!canSend}
                className="px-4 py-2 text-sm rounded-card bg-ink text-white hover:bg-ink/90 disabled:opacity-40"
              >
                {sending ? "Отправляем…" : "Отправить"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// --- Мягкий вопрос «Нравится Тетрадь?» ---
// Появляется, когда человек пользовался приложением хотя бы 3 разных дня, и только если он ещё
// не оставлял отзыв и не нажимал «Позже» за последние 30 дней. Это удобство на одном устройстве —
// поэтому localStorage (если он недоступен, вопрос просто не показывается).

const DAYS_KEY = "tetrad.feedback.activeDays";
const SNOOZE_KEY = "tetrad.feedback.snoozedUntil";
const GIVEN_KEY = "tetrad.feedback.given";
const MIN_DAYS = 3;
const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Хранилище браузера недоступно (приватный режим) — просто не запоминаем
  }
}

function markFeedbackGiven() {
  safeSet(GIVEN_KEY, "1");
}

function shouldAskForFeedback(): boolean {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const days: string[] = JSON.parse(safeGet(DAYS_KEY) ?? "[]");
    if (!days.includes(today)) {
      days.push(today);
      safeSet(DAYS_KEY, JSON.stringify(days.slice(-10)));
    }
    if (safeGet(GIVEN_KEY)) return false;
    if (Number(safeGet(SNOOZE_KEY) ?? 0) > Date.now()) return false;
    return days.length >= MIN_DAYS;
  } catch {
    return false;
  }
}

export function FeedbackPrompt() {
  const [visible, setVisible] = useState(false);
  const [modalRating, setModalRating] = useState<number | null>(null);

  useEffect(() => {
    // Не сразу при входе — пусть человек сначала откроет то, за чем пришёл
    const timer = window.setTimeout(() => setVisible(shouldAskForFeedback()), 20_000);
    return () => window.clearTimeout(timer);
  }, []);

  function snooze() {
    safeSet(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    setVisible(false);
  }

  if (modalRating !== null) {
    return (
      <FeedbackModal
        initialRating={modalRating}
        onClose={() => {
          setModalRating(null);
          setVisible(false);
          snooze(); // закрыл без отправки — не спрашиваем ещё месяц
        }}
      />
    );
  }
  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Нравится Тетрадь?"
      className="fixed z-40 bottom-20 md:bottom-6 right-4 left-4 md:left-auto md:w-80 bg-card border border-line rounded-card shadow-lg p-4 print:hidden"
    >
      <p className="text-sm font-medium mb-3">Нравится «Тетрадь»?</p>
      <div className="flex justify-between mb-3">
        {RATINGS.map((r) => (
          <button
            key={r.value}
            onClick={() => setModalRating(r.value)}
            className="text-2xl rounded-card px-1.5 py-1 hover:bg-paper hover:scale-110 transition-transform"
            aria-label={r.label}
            title={r.label}
          >
            {r.emoji}
          </button>
        ))}
      </div>
      <button onClick={snooze} className="text-xs text-ink/40 hover:text-ink">
        Позже
      </button>
    </div>
  );
}
