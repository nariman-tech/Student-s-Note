import { useState } from "react";
import { setNewPassword, authErrorMessage } from "../lib/auth";

// Экран после перехода по ссылке «сбросить пароль» из письма: Supabase уже впустил пользователя
// по этой ссылке, осталось задать новый пароль
export default function ResetPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      setError("Минимум 6 символов.");
      return;
    }
    if (password !== repeat) {
      setError("Пароли не совпадают.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await setNewPassword(password);
      onDone();
    } catch (err: any) {
      setError(authErrorMessage(err));
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper">
      <form onSubmit={handleSubmit} className="w-full max-w-sm p-8 rounded-card border border-line bg-card">
        <h2 className="font-display font-800 text-lg mb-1">Новый пароль</h2>
        <p className="text-sm text-ink/50 mb-5">Придумайте новый пароль для входа в Lectiva.</p>
        <input
          type="password"
          autoFocus
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Новый пароль"
          autoComplete="new-password"
          className="w-full rounded-card border border-line px-3 py-2.5 text-sm mb-3"
        />
        <input
          type="password"
          required
          minLength={6}
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          placeholder="Повторите пароль"
          autoComplete="new-password"
          className="w-full rounded-card border border-line px-3 py-2.5 text-sm mb-3"
        />
        {error && <p className="text-xs text-coral mb-3">{error}</p>}
        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-card bg-ink text-white py-2.5 text-sm font-medium hover:bg-ink/90 disabled:opacity-50"
        >
          {saving ? "Сохраняем…" : "Сохранить и войти"}
        </button>
      </form>
    </div>
  );
}
