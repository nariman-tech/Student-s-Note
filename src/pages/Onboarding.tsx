import { useRef, useState } from "react";
import { createMyPublicProfile, updateMyGender, cleanUsername, profileErrorMessage } from "../lib/store";
import { uploadImage } from "../lib/upload";
import { PublicProfile } from "../types";

interface Props {
  onDone: (profile: PublicProfile) => void;
}

const GENDERS = [
  { value: "male", label: "Мужской" },
  { value: "female", label: "Женский" },
  { value: "unspecified", label: "Не указывать" },
] as const;

export default function Onboarding({ onDone }: Props) {
  const [username, setUsername] = useState("");
  const [gender, setGender] = useState<(typeof GENDERS)[number]["value"]>("unspecified");
  // avatar — локальное превью (blob:), avatarFile — сам файл; в Storage грузим при сохранении профиля
  const [avatar, setAvatar] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (avatar) URL.revokeObjectURL(avatar);
    setAvatar(URL.createObjectURL(file));
    setAvatarFile(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const clean = cleanUsername(username);
    if (!clean) return;
    setSaving(true);
    setError("");
    try {
      const avatarUrl = avatarFile ? await uploadImage(avatarFile, 256) : undefined;
      const profile = await createMyPublicProfile(clean, avatarUrl);
      await updateMyGender(gender).catch(() => {}); // необязательное поле — не блокируем вход, если не сохранилось
      onDone(profile);
    } catch (err: any) {
      setError(profileErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper">
      <form onSubmit={handleSubmit} className="w-full max-w-sm p-8 rounded-card border border-line bg-card">
        <h1 className="text-xl font-display font-800 mb-1">Как вас называть?</h1>
        <p className="text-sm text-ink/50 mb-6">Юзернейм и аватарка — чтобы друзья вас узнавали</p>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="w-20 h-20 rounded-full mx-auto mb-4 overflow-hidden border-2 border-dashed border-line flex items-center justify-center hover:border-ink/40"
        >
          {avatar ? (
            <img src={avatar} alt="Аватарка" className="w-full h-full object-cover" />
          ) : (
            <span className="text-2xl">🙂</span>
          )}
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
        <p className="text-center text-[11px] text-ink/40 mb-5">Аватарка необязательна</p>

        <div className="flex items-center rounded-card border border-line mb-2 overflow-hidden">
          <span className="pl-3 text-sm text-ink/40">@</span>
          <input
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={30}
            placeholder="username"
            className="flex-1 px-2 py-2.5 text-sm outline-none"
          />
        </div>
        {error && <p className="text-xs text-coral mb-2">{error}</p>}
        <p className="text-[11px] text-ink/40 mb-4">Латинские буквы, цифры, подчёркивание</p>

        <div className="flex rounded-card bg-paper p-1 mb-5">
          {GENDERS.map((g) => (
            <button
              key={g.value}
              type="button"
              onClick={() => setGender(g.value)}
              className={`flex-1 text-xs py-1.5 rounded-card ${
                gender === g.value ? "bg-card shadow-sm font-medium" : "text-ink/50"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>

        <button
          type="submit"
          disabled={!username.trim() || saving}
          className="w-full rounded-card bg-ink text-white py-2.5 text-sm font-medium hover:bg-ink/90 disabled:opacity-50"
        >
          {saving ? "Сохраняем…" : "Продолжить"}
        </button>
      </form>
    </div>
  );
}
