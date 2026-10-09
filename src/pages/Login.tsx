import { useEffect, useState } from "react";
import { signInWithPassword, signInWithGoogle, sendPasswordReset, authErrorMessage } from "../lib/auth";

// Вход: новые пользователи регистрируются только через Google (один клик, без фейковых почт и писем).
// Вход по почте и паролю оставлен для уже существующих аккаунтов (в том числе тестовых) — спрятан за ссылкой.
export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [googleLoading, setGoogleLoading] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);

  // Вход через Google не удался — Supabase возвращает на сайт с ошибкой в адресе
  // (?error_description=… или #error_description=…). Показываем её понятным текстом и убираем из адреса,
  // иначе человек молча видит экран входа заново и думает, что кнопка не работает
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const message = query.get("error_description") ?? hash.get("error_description");
    if (!message) return;
    const code = query.get("error_code") ?? hash.get("error_code") ?? undefined;
    setStatus("error");
    setErrorMsg(authErrorMessage({ code, message: message.replace(/\+/g, " ") }));
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setStatus("loading");
    setErrorMsg("");
    try {
      await signInWithPassword(email.trim(), password);
      // Дальше сессия появится сама — App.tsx подхватит её через onAuthStateChange
      setStatus("idle");
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(authErrorMessage(err));
    }
  }

  async function handleGoogle() {
    setGoogleLoading(true);
    setStatus("idle");
    try {
      await signInWithGoogle();
    } catch (err: any) {
      setGoogleLoading(false);
      setStatus("error");
      setErrorMsg(authErrorMessage(err));
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper p-4">
      <div className="w-full max-w-sm p-8 rounded-card border border-line bg-card">
        <div className="text-center mb-6">
          <img src="/icons/icon-192.png" alt="" className="w-14 h-14 mx-auto mb-2 rounded-2xl" />
          <h1 className="font-display font-800 text-2xl">Lectiva</h1>
          <p className="text-sm text-ink/50 mt-1">Конспекты, флеш-карты и учёба вместе с группой</p>
        </div>

        <button
          onClick={handleGoogle}
          disabled={googleLoading}
          className="w-full flex items-center justify-center gap-2 rounded-card bg-ink text-white py-3 text-sm font-medium hover:bg-ink/90 disabled:opacity-50"
        >
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
          </svg>
          {googleLoading ? "Открываем Google…" : "Войти через Google"}
        </button>
        <p className="text-center text-[11px] text-ink/40 mt-2">Нет аккаунта? Он создастся сам при первом входе</p>

        {status === "error" && !emailOpen && <p className="text-xs text-coral text-center mt-3">{errorMsg}</p>}

        {!emailOpen ? (
          <button
            onClick={() => {
              setEmailOpen(true);
              setStatus("idle");
            }}
            className="block mx-auto text-xs text-ink/50 hover:text-ink mt-6"
          >
            Войти по почте и паролю
          </button>
        ) : forgotOpen ? (
          <div className="mt-6">
            <ForgotPassword initialEmail={email} onBack={() => setForgotOpen(false)} />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6">
            <div className="flex items-center gap-3 mb-4">
              <span className="flex-1 h-px bg-line" />
              <span className="text-xs text-ink/40">вход по почте</span>
              <span className="flex-1 h-px bg-line" />
            </div>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Почта"
              autoComplete="email"
              className="w-full rounded-card border border-line px-3 py-2.5 text-sm mb-3"
            />
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Пароль"
              autoComplete="current-password"
              className="w-full rounded-card border border-line px-3 py-2.5 text-sm mb-3"
            />
            <button
              type="submit"
              disabled={status === "loading"}
              className="w-full rounded-card border border-line py-2.5 text-sm font-medium hover:border-ink/40 disabled:opacity-50"
            >
              {status === "loading" ? "Секунду…" : "Войти"}
            </button>
            {status === "error" && <p className="text-xs text-coral mt-2">{errorMsg}</p>}
            <div className="flex justify-between mt-3">
              <button
                type="button"
                onClick={() => {
                  setEmailOpen(false);
                  setStatus("idle");
                }}
                className="text-xs text-ink/50 hover:text-ink"
              >
                ← Назад
              </button>
              <button
                type="button"
                onClick={() => {
                  setForgotOpen(true);
                  setStatus("idle");
                }}
                className="text-xs text-ink/50 hover:text-ink"
              >
                Забыли пароль?
              </button>
            </div>
          </form>
        )}

        <p className="text-center text-[11px] text-ink/40 mt-6">
          <a href="/privacy" className="hover:text-ink underline">
            Политика конфиденциальности
          </a>
        </p>
      </div>
    </div>
  );
}

function ForgotPassword({ initialEmail, onBack }: { initialEmail: string; onBack: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setState("sending");
    setError("");
    try {
      await sendPasswordReset(email.trim());
      setState("sent");
    } catch (err: any) {
      setError(authErrorMessage(err));
      setState("idle");
    }
  }

  if (state === "sent") {
    return (
      <div className="text-sm text-sage bg-sage/10 rounded-card p-3">
        <p>
          Если аккаунт с почтой {email} существует, на неё придёт письмо со ссылкой для сброса пароля (проверьте и «Спам»).
          Откройте ссылку — приложение попросит придумать новый пароль.
        </p>
        <button onClick={onBack} className="text-xs text-ink/60 hover:text-ink mt-3">
          ← Вернуться ко входу
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <p className="text-sm text-ink/60 mb-3">Введите почту — пришлём ссылку для сброса пароля.</p>
      <input
        type="email"
        required
        autoFocus
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Почта"
        className="w-full rounded-card border border-line px-3 py-2.5 text-sm mb-3"
      />
      <button
        type="submit"
        disabled={state === "sending"}
        className="w-full rounded-card bg-ink text-white py-2.5 text-sm font-medium hover:bg-ink/90 disabled:opacity-50"
      >
        {state === "sending" ? "Отправляем…" : "Прислать ссылку"}
      </button>
      {error && <p className="text-xs text-coral mt-2">{error}</p>}
      <button type="button" onClick={onBack} className="block mx-auto text-xs text-ink/50 hover:text-ink mt-3">
        ← Вернуться ко входу
      </button>
    </form>
  );
}
