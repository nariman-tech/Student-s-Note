import { useState } from "react";

// Подтверждение опасного действия (удаление и т.п.) в стиле приложения — вместо window.confirm,
// который выглядит по-разному в браузерах и в окне Tauri
export default function ConfirmDialog({
  title,
  text,
  confirmLabel = "Удалить",
  onConfirm,
  onClose,
}: {
  title: string;
  text: string;
  confirmLabel?: string;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleConfirm() {
    setBusy(true);
    setError("");
    try {
      await onConfirm();
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "Не получилось. Попробуйте ещё раз.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-40 p-4" onClick={busy ? undefined : onClose}>
      <div className="bg-card rounded-card p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-700 mb-2">{title}</h3>
        <p className="text-sm text-ink/60 mb-5">{text}</p>
        {error && <p className="text-xs text-coral mb-3">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="px-4 py-2 text-sm text-ink/60 hover:text-ink">
            Отмена
          </button>
          <button
            onClick={handleConfirm}
            disabled={busy}
            className="px-4 py-2 text-sm rounded-card bg-coral text-white font-medium hover:brightness-95 disabled:opacity-50"
          >
            {busy ? "Секунду…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
