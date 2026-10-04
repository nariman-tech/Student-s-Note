import { useState } from "react";
import {
  signInWithPassword,
  signUpWithPassword,
  signInWithGoogle,
  resendConfirmation,
  sendPasswordReset,
  authErrorMessage,
} from "../lib/auth";

export default function Login() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "check-email" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [googleLoading, setGoogleLoading] = useState(false);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");
  const [forgotOpen, setForgotOpen] = useState(false);

  async function handleResend() {
    setResendState("sending");
    try {
      await resendConfirmation(email.trim());
      setResendState("sent");
    } catch (err: any) {
      setResendState("idle");
      setStatus("error");
      setErrorMsg(authErrorMessage(err));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setStatus("loading");
    setErrorMsg("");
    setNeedsConfirm(false);
    setResendState("idle");
    try {
      if (mode === "login") {
        await signInWithPassword(email.trim(), password);
        // Дальше сессия появится сама — App.tsx подхватит её через onAuthStateChange
      } else {
        const hasSession = await signUpWithPassword(email.trim(), password);
        if (!hasSession) {
          setStatus("check-email");
          return;
        }
      }
      setStatus("idle");
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(authErrorMessage(err));
      setNeedsConfirm(err?.code === "email_not_confirmed" || /email not confirmed/i.test(err?.message ?? ""));
    }
  }

  async function handleGoogle() {
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      setGoogleLoading(false);
      setStatus("error");
      setErrorMsg(authErrorMessage(err));
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper">
      <div className="w-full max-w-sm p-8 rounded-card border border-line bg-card">
        <button
          onClick={handleGoogle}
          disabled={googleLoading}
          className="w-full flex items-center justify-center gap-2 rounded-card border border-line py-2.5 text-sm font-medium hover:border-ink/40 mb-4 disabled:opacity-50"
        >
          {googleLoading ? "Открываем Google…" : "Войти через Google"}
        </button>

        <div className="flex items-center gap-3 mb-4">
          <span className="flex-1 h-px bg-line" />
          <span className="text-xs text-ink/40">или</span>
          <span className="flex-1 h-px bg-line" />
        </div>

        <div className="flex rounded-card bg-paper p-1 mb-4">
          <button
            onClick={() => {
              setMode("login");
              setForgotOpen(false);
              setStatus("idle");
            }}
            className={`flex-1 text-sm py-1.5 rounded-card ${mode === "login" ? "bg-card shadow-sm font-medium" : "text-ink/50"}`}
          >
            Войти
          </button>
          <button
            onClick={() => {
              setMode("register");
              setForgotOpen(false);
              setStatus("idle");
            }}
            className={`flex-1 text-sm py-1.5 rounded-card ${mode === "register" ? "bg-card shadow-sm font-medium" : "text-ink/50"}`}
          >
            Регистрация
          </button>
        </div>

        {status === "check-email" ? (
          <div className="text-sm text-sage bg-sage/10 rounded-card p-3">
            <p>
              Проверьте почту {email} — там ссылка для подтверждения (если письма нет, загляните в «Спам»).
              После подтверждения возвращайтесь сюда и входите паролем, который только что придумали.
            </p>
            <div className="flex gap-3 mt-3">
              <button
                onClick={() => {
                  setMode("login");
                  setForgotOpen(false);
                  setStatus("idle");
                }}
                className="text-xs rounded-card bg-ink text-white px-3 py-1.5 font-medium hover:bg-ink/90"
              >
                Я подтвердил — войти
              </button>
              <button
                onClick={handleResend}
                disabled={resendState !== "idle"}
                className="text-xs text-ink/60 hover:text-ink disabled:opacity-60"
              >
                {resendState === "sent" ? "Письмо отправлено ✓" : resendState === "sending" ? "Отправляем…" : "Отправить ещё раз"}
              </button>
            </div>
          </div>
        ) : forgotOpen ? (
          <ForgotPassword initialEmail={email} onBack={() => setForgotOpen(false)} />
        ) : (
          <form onSubmit={handleSubmit}>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Почта"
              className="w-full rounded-card border border-line px-3 py-2.5 text-sm mb-3"
            />
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Пароль"
              className="w-full rounded-card border border-line px-3 py-2.5 text-sm mb-3"
            />
            <button
              type="submit"
              disabled={status === "loading"}
              className="w-full rounded-card bg-ink text-white py-2.5 text-sm font-medium hover:bg-ink/90 disabled:opacity-50"
            >
              {status === "loading" ? "Секунду…" : mode === "login" ? "Войти" : "Зарегистрироваться"}
            </button>
            {status === "error" && <p className="text-xs text-coral mt-2">{errorMsg}</p>}
            {status === "error" && needsConfirm && (
              <button
                type="button"
                onClick={handleResend}
                disabled={resendState !== "idle"}
                className="text-xs text-ink/60 hover:text-ink underline mt-1 disabled:opacity-60 disabled:no-underline"
              >
                {resendState === "sent" ? "Письмо отправлено ✓" : resendState === "sending" ? "Отправляем…" : "Отправить письмо ещё раз"}
              </button>
            )}
            {mode === "login" && (
              <button
                type="button"
                onClick={() => {
                  setForgotOpen(true);
                  setStatus("idle");
                }}
                className="block mx-auto text-xs text-ink/50 hover:text-ink mt-3"
              >
                Забыли пароль?
              </button>
            )}
          </form>
        )}
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
