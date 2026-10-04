import { useEffect, useRef, useState } from "react";
import { updateMyPublicProfile, cleanUsername, profileErrorMessage, formatPublicId } from "../lib/store";
import { uploadImage } from "../lib/upload";
import { signOut } from "../lib/auth";
import { isAdmin } from "../lib/analytics";
import { FeedbackModal } from "./Feedback";
import { useNavigate } from "react-router-dom";
import { PublicProfile } from "../types";

// Настройки профиля: аватарка и юзернейм. ID показываем, но менять его нельзя.
export default function ProfileModal({
  profile,
  onSaved,
  onClose,
}: {
  profile: PublicProfile;
  onSaved: (profile: PublicProfile) => void;
  onClose: () => void;
}) {
  const [username, setUsername] = useState(profile.username);
  // avatarPreview: что показываем сейчас; avatarFile: новый файл (грузим при сохранении);
  // avatarRemoved: пользователь нажал «Убрать фото»
  const [avatarPreview, setAvatarPreview] = useState<string | undefined>(profile.avatarUrl);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarRemoved, setAvatarRemoved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [admin, setAdmin] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    isAdmin().then(setAdmin);
  }, []);

  // Освобождаем локальное превью (blob:), когда оно больше не нужно
  useEffect(() => {
    return () => {
      if (avatarPreview?.startsWith("blob:")) URL.revokeObjectURL(avatarPreview);
    };
  }, [avatarPreview]);

  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setAvatarPreview(URL.createObjectURL(file));
    setAvatarFile(file);
    setAvatarRemoved(false);
  }

  function handleAvatarRemove() {
    setAvatarPreview(undefined);
    setAvatarFile(null);
    setAvatarRemoved(true);
  }

  const clean = cleanUsername(username);
  const usernameChanged = clean !== profile.username;
  const avatarChanged = avatarFile !== null || avatarRemoved;
  const canSave = clean.length > 0 && (usernameChanged || avatarChanged);

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      let avatarUrl: string | null | undefined = undefined;
      if (avatarFile) avatarUrl = await uploadImage(avatarFile, 256);
      else if (avatarRemoved) avatarUrl = null;

      const updated = await updateMyPublicProfile(
        { username: usernameChanged ? clean : undefined, avatarUrl },
        profile.avatarUrl
      );
      onSaved(updated);
      onClose();
    } catch (err: any) {
      setError(profileErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-40 p-4 text-ink" onClick={saving ? undefined : onClose}>
      <div className="bg-card rounded-card p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display font-700 mb-4">Профиль</h3>

        <div className="flex items-center gap-4 mb-5">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-20 h-20 rounded-full bg-lavender/30 flex items-center justify-center overflow-hidden shrink-0 border-2 border-dashed border-line hover:border-ink/40"
            title="Сменить фото"
          >
            {avatarPreview ? (
              <img src={avatarPreview} alt="Аватарка" className="w-full h-full object-cover" />
            ) : (
              <span className="text-2xl font-semibold">{(clean || profile.username)[0]?.toUpperCase()}</span>
            )}
          </button>
          <div className="flex flex-col items-start gap-1.5">
            <button onClick={() => fileInputRef.current?.click()} className="text-sm text-ink/70 hover:text-ink">
              🖼 Сменить фото
            </button>
            {avatarPreview && (
              <button onClick={handleAvatarRemove} className="text-xs text-ink/40 hover:text-coral">
                Убрать фото
              </button>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
        </div>

        <label className="text-xs text-ink/50 mb-1 block">Юзернейм</label>
        <div className="flex items-center rounded-card border border-line mb-1 overflow-hidden">
          <span className="pl-3 text-sm text-ink/40">@</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            maxLength={31}
            className="flex-1 px-2 py-2.5 text-sm outline-none"
          />
        </div>
        <p className="text-[11px] text-ink/40 mb-4">
          Латинские буквы, цифры, подчёркивание{usernameChanged && clean && ` · будет: @${clean}`}
        </p>

        <p className="text-xs text-ink/50 mb-5">
          Ваш ID: <span className="font-medium text-ink">{formatPublicId(profile.publicId)}</span> — он не меняется
        </p>

        {error && <p className="text-xs text-coral mb-3">{error}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm text-ink/60 hover:text-ink">
            Отмена
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            className="px-4 py-2 text-sm rounded-card bg-ink text-white hover:bg-ink/90 disabled:opacity-40"
          >
            {saving ? "Сохраняем…" : "Сохранить"}
          </button>
        </div>

        {/* На телефоне нет боковой панели — отзыв, аналитика и выход здесь */}
        <div className="md:hidden flex flex-col gap-2 mt-5 pt-4 border-t border-line">
          <button onClick={() => setFeedbackOpen(true)} className="text-sm text-ink/70 hover:text-ink text-center">
            💬 Оставить отзыв
          </button>
          {admin && (
            <button
              onClick={() => {
                onClose();
                navigate("/admin");
              }}
              className="text-sm text-ink/70 hover:text-ink text-center"
            >
              📊 Аналитика
            </button>
          )}
        </div>
        <button
          onClick={() => signOut()}
          disabled={saving}
          className="md:hidden w-full mt-3 text-sm text-coral text-center"
        >
          🚪 Выйти из аккаунта
        </button>
        {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}
      </div>
    </div>
  );
}
