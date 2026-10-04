// Ссылки для мессенджеров: доступ по ссылке к тетрадям и модулям + приглашение в группу.

import { supabase } from "./supabase";

// Адрес, по которому приложение доступно другим людям. Пока приложение не опубликовано
// в интернете, это localhost — такая ссылка откроется только на вашем компьютере.
// После публикации (например, на Vercel) укажите адрес в .env: VITE_PUBLIC_APP_URL=https://…
export function publicAppUrl(): string {
  return (import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin).replace(/\/$/, "");
}

export function isLocalAppUrl(): boolean {
  return /\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(publicAppUrl());
}

export const notebookLink = (token: string) => `${publicAppUrl()}/s/n/${token}`;
export const flashcardSetLink = (token: string) => `${publicAppUrl()}/s/f/${token}`;
export const groupInviteLink = (code: string) => `${publicAppUrl()}/join/${code}`;

// 24 случайных символа (~143 бита) — ссылку невозможно подобрать перебором
function generateToken(): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

type LinkTable = "notebooks" | "flashcard_sets";

export async function getShareToken(table: LinkTable, id: string): Promise<string | null> {
  const { data, error } = await supabase.from(table).select("share_token").eq("id", id).maybeSingle();
  if (error) throw error;
  return data?.share_token ?? null;
}

export async function enableShareLink(table: LinkTable, id: string): Promise<string> {
  const token = generateToken();
  const { error } = await supabase.from(table).update({ share_token: token }).eq("id", id);
  if (error) throw error;
  return token;
}

export async function disableShareLink(table: LinkTable, id: string) {
  const { error } = await supabase.from(table).update({ share_token: null }).eq("id", id);
  if (error) throw error;
}

// --- Открытие по ссылке (работает и без входа в аккаунт) ---

export interface PublicNotebook {
  title: string;
  iconEmoji: string;
  coverImageUrl?: string;
  spineColor: string;
  pages: { id: string; title: string; content: string; attachments: { id: string; type: string; url: string; name: string }[] }[];
  ownerUsername?: string;
}

export async function getPublicNotebook(token: string): Promise<PublicNotebook | null> {
  const { data, error } = await supabase.rpc("get_public_notebook", { token });
  if (error) throw error;
  if (!data) return null;
  return {
    title: data.title,
    iconEmoji: data.icon_emoji,
    coverImageUrl: data.cover_image_url ?? undefined,
    spineColor: data.spine_color,
    pages: (data.pages ?? []).map((p: any) => ({ id: p.id, title: p.title, content: p.content ?? "", attachments: p.attachments ?? [] })),
    ownerUsername: data.owner_username ?? undefined,
  };
}

export interface PublicFlashcardSet {
  title: string;
  color: string;
  cards: { id: string; front: string; back: string }[];
  ownerUsername?: string;
}

export async function getPublicFlashcardSet(token: string): Promise<PublicFlashcardSet | null> {
  const { data, error } = await supabase.rpc("get_public_flashcard_set", { token });
  if (error) throw error;
  if (!data) return null;
  return { title: data.title, color: data.color, cards: data.cards ?? [], ownerUsername: data.owner_username ?? undefined };
}
