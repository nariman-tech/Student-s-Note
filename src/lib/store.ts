// Слой данных приложения — теперь настоящие запросы к Supabase вместо localStorage.
// Названия функций и их сигнатуры специально остались почти такими же, как раньше,
// чтобы страницы менялись минимально — только добавился await и обработка ошибок.

import { supabase } from "./supabase";
import { removeUploadedFiles } from "./upload";
import {
  Notebook,
  NotePage,
  PageSummary,
  NoteAttachment,
  FlashcardSet,
  Group,
  GroupMember,
  GroupMessage,
  ChatAttachment,
  Friend,
  PublicProfile,
  IncomingRequest,
  SharedNotebook,
  SharedFlashcardSet,
  SearchResult,
} from "../types";

export async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Не авторизованы");
  return data.user.id;
}

// --- Тетради ---

// Только свои личные тетради — открытые мне друзьями отдаёт getSharedWithMe, тетради групп — getGroupNotebooks
export async function getNotebooks(): Promise<Notebook[]> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("notebooks")
    .select("*")
    .eq("owner_id", userId)
    .is("group_id", null)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToNotebook);
}

export async function getNotebook(id: string): Promise<Notebook | undefined> {
  const { data, error } = await supabase.from("notebooks").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? rowToNotebook(data) : undefined;
}

// Поиск по названиям и по тексту конспектов (свои тетради и открытые мне друзьями) —
// функция search_notebooks в базе (migration_011): русские словоформы, поиск по началу слова
export async function searchNotebooks(query: string): Promise<SearchResult[]> {
  if (!query.trim()) return [];
  const { data, error } = await supabase.rpc("search_notebooks", { q: query });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    title: r.title,
    iconEmoji: r.icon_emoji,
    ownerId: r.owner_id,
    pageId: r.page_id ?? undefined,
    pageTitle: r.page_title ?? undefined,
    snippet: r.snippet ?? undefined,
  }));
}

export async function addNotebook(input: {
  title: string;
  coverImageUrl?: string;
  spineColor: string;
  courseTag?: string;
  groupId?: string; // тетрадь группы
}): Promise<Notebook> {
  const ownerId = await currentUserId();
  const { data, error } = await supabase
    .from("notebooks")
    .insert({
      owner_id: ownerId,
      title: input.title,
      icon_emoji: input.title.trim().charAt(0).toUpperCase() || "📓",
      cover_image_url: input.coverImageUrl ?? null,
      spine_color: input.spineColor,
      course_tag: input.courseTag ?? null,
      group_id: input.groupId ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  // Первая страница — сразу вместе с тетрадью, чтобы в ней можно было начать писать
  await createPage(data.id, "Страница 1", 0);
  return rowToNotebook(data);
}

export async function renameNotebook(id: string, title: string) {
  const { error } = await supabase
    .from("notebooks")
    .update({ title, icon_emoji: title.trim().charAt(0).toUpperCase() || "📓", updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

// Страницы удаляются вместе с тетрадью сами (on delete cascade), а файлы из Storage — отдельно:
// сначала собираем ссылки на них, потом удаляем тетрадь, потом файлы
export async function deleteNotebook(id: string) {
  const [{ data: nb }, { data: pages }] = await Promise.all([
    supabase.from("notebooks").select("cover_image_url").eq("id", id).maybeSingle(),
    supabase.from("notes").select("content, attachments").eq("notebook_id", id),
  ]);
  const { error } = await supabase.from("notebooks").delete().eq("id", id);
  if (error) throw error;
  await removeUploadedFiles([
    nb?.cover_image_url ?? undefined,
    ...(pages ?? []).flatMap((p) => [p.content ?? undefined, ...((p.attachments ?? []) as NoteAttachment[]).map((a) => a.url)]),
  ]);
}

// Новая обложка (или null — убрать). Старый файл удаляем из хранилища
export async function updateNotebookCover(id: string, coverImageUrl: string | null, previousUrl?: string) {
  const { error } = await supabase.from("notebooks").update({ cover_image_url: coverImageUrl }).eq("id", id);
  if (error) throw error;
  if (previousUrl && previousUrl !== coverImageUrl) await removeUploadedFiles([previousUrl]);
}

// --- Поделиться тетрадью с другом (только чтение) ---

export async function getNotebookShares(notebookId: string): Promise<string[]> {
  const { data, error } = await supabase.from("notebook_shares").select("shared_with").eq("notebook_id", notebookId);
  if (error) throw error;
  return (data ?? []).map((r) => r.shared_with);
}

// Какие из моих тетрадей открыты этому другу
export async function getNotebookSharesForFriend(friendUserId: string): Promise<string[]> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("notebook_shares")
    .select("notebook_id")
    .eq("owner_id", userId)
    .eq("shared_with", friendUserId);
  if (error) throw error;
  return (data ?? []).map((r) => r.notebook_id);
}

export async function shareNotebook(notebookId: string, friendUserId: string) {
  const ownerId = await currentUserId();
  const { error } = await supabase
    .from("notebook_shares")
    .upsert({ notebook_id: notebookId, owner_id: ownerId, shared_with: friendUserId }, { onConflict: "notebook_id,shared_with", ignoreDuplicates: true });
  if (error) throw error;
}

export async function unshareNotebook(notebookId: string, friendUserId: string) {
  const { error } = await supabase.from("notebook_shares").delete().eq("notebook_id", notebookId).eq("shared_with", friendUserId);
  if (error) throw error;
}

export async function getSharedWithMe(): Promise<SharedNotebook[]> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("notebook_shares")
    .select("created_at, notebooks(*), owner:public_profiles!notebook_shares_owner_id_fkey(id, username, avatar_url, public_id)")
    .eq("shared_with", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? [])
    .filter((r: any) => r.notebooks && r.owner)
    .map((r: any) => ({ notebook: rowToNotebook(r.notebooks), owner: rowToProfile(r.owner) }));
}

export async function touchNotebook(id: string) {
  await supabase.from("notebooks").update({ updated_at: new Date().toISOString() }).eq("id", id);
}

function rowToNotebook(row: any): Notebook {
  return {
    id: row.id,
    title: row.title,
    iconEmoji: row.icon_emoji,
    coverImageUrl: row.cover_image_url ?? undefined,
    spineColor: row.spine_color,
    courseTag: row.course_tag ?? undefined,
    updatedAt: (row.updated_at ?? row.created_at ?? "").slice(0, 10),
    ownerId: row.owner_id,
    groupId: row.group_id ?? undefined,
  };
}

// Тетради группы — для вкладки «Тетради» в группе
export async function getGroupNotebooks(groupId: string): Promise<Notebook[]> {
  const { data, error } = await supabase
    .from("notebooks")
    .select("*")
    .eq("group_id", groupId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToNotebook);
}

// --- Страницы тетради ---

// Список страниц по порядку — без содержимого, чтобы тетрадь со многими страницами открывалась быстро
export async function getPages(notebookId: string): Promise<PageSummary[]> {
  const { data, error } = await supabase
    .from("notes")
    .select("id, title, position")
    .eq("notebook_id", notebookId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id, title: r.title, position: r.position }));
}

function rowToPage(r: any): NotePage {
  return {
    id: r.id,
    notebookId: r.notebook_id,
    title: r.title,
    position: r.position,
    content: r.content ?? "",
    attachments: (r.attachments ?? []) as NoteAttachment[],
    updatedAt: r.updated_at,
    updatedBy: r.updated_by ?? undefined,
  };
}

export async function getPage(pageId: string): Promise<NotePage | undefined> {
  const { data, error } = await supabase.from("notes").select("*").eq("id", pageId).maybeSingle();
  if (error) throw error;
  return data ? rowToPage(data) : undefined;
}

// Все страницы с содержимым — для PDF всей тетради
export async function getAllPages(notebookId: string): Promise<NotePage[]> {
  const { data, error } = await supabase
    .from("notes")
    .select("*")
    .eq("notebook_id", notebookId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToPage);
}

export async function createPage(notebookId: string, title: string, position: number): Promise<PageSummary> {
  const ownerId = await currentUserId();
  const { data, error } = await supabase
    .from("notes")
    .insert({ notebook_id: notebookId, owner_id: ownerId, title, position, content: "", attachments: [] })
    .select("id, title, position")
    .single();
  if (error) throw error;
  await touchNotebook(notebookId);
  return { id: data.id, title: data.title, position: data.position };
}

export async function renamePage(pageId: string, title: string) {
  const { error } = await supabase.from("notes").update({ title }).eq("id", pageId);
  if (error) throw error;
}

// Картинки и файлы страницы удаляем из хранилища вместе с ней
export async function deletePage(page: NotePage) {
  const { error } = await supabase.from("notes").delete().eq("id", page.id);
  if (error) throw error;
  await removeUploadedFiles([page.content, ...page.attachments.map((a) => a.url)]);
  await touchNotebook(page.notebookId);
}

// Порядок страниц: сохраняем position = номер в списке
export async function reorderPages(pageIds: string[]) {
  const results = await Promise.all(pageIds.map((id, i) => supabase.from("notes").update({ position: i }).eq("id", id)));
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
}

// Страницу изменил кто-то другой (или вы в другой вкладке) с тех пор, как вы её открыли
export class PageConflictError extends Error {
  constructor() {
    super("Страницу только что изменил другой участник");
  }
}

// Сохранение с защитой от затирания чужих правок: сохраняем, только если страница не менялась
// с момента expectedUpdatedAt (иначе — PageConflictError). force — сохранить поверх в любом случае.
// Возвращает новое время сохранения — оно станет expectedUpdatedAt для следующего сохранения.
export async function savePage(
  page: { id: string; notebookId: string },
  content: string,
  attachments: NoteAttachment[],
  expectedUpdatedAt: string | null,
  force = false
): Promise<string> {
  const userId = await currentUserId();
  let query = supabase
    .from("notes")
    .update({ content, attachments, updated_at: new Date().toISOString(), updated_by: userId })
    .eq("id", page.id);
  if (!force && expectedUpdatedAt) query = query.eq("updated_at", expectedUpdatedAt);
  const { data, error } = await query.select("updated_at");
  if (error) throw error;
  if (!data || data.length === 0) throw new PageConflictError();
  await touchNotebook(page.notebookId);
  return data[0].updated_at;
}

// Изменения открытой страницы от других участников — сразу, без обновления (Supabase Realtime)
export function subscribeToPage(pageId: string, onChange: (page: NotePage) => void): () => void {
  const channel = supabase
    .channel(`page-${pageId}-${crypto.randomUUID()}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "notes", filter: `id=eq.${pageId}` }, (payload) =>
      onChange(rowToPage(payload.new))
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

// --- Флеш-карты ---

// Только свои модули — открытые мне друзьями отдаёт getSharedFlashcardSetsWithMe
export async function getFlashcardSets(): Promise<FlashcardSet[]> {
  const userId = await currentUserId();
  const { data: sets, error } = await supabase
    .from("flashcard_sets")
    .select("*")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return withCards(sets ?? []);
}

// Подтягиваем карточки для списка модулей одним запросом
async function withCards(sets: any[]): Promise<FlashcardSet[]> {
  if (sets.length === 0) return [];
  const { data: cards, error } = await supabase
    .from("flashcards")
    .select("*")
    .in(
      "set_id",
      sets.map((s) => s.id)
    );
  if (error) throw error;
  return sets.map((s) => ({
    id: s.id,
    title: s.title,
    color: s.color,
    cards: (cards ?? []).filter((c) => c.set_id === s.id).map((c) => ({ id: c.id, front: c.front, back: c.back })),
  }));
}

// --- Поделиться модулем флеш-карт с другом (только изучать) ---

export async function getFlashcardSetShares(setId: string): Promise<string[]> {
  const { data, error } = await supabase.from("flashcard_set_shares").select("shared_with").eq("set_id", setId);
  if (error) throw error;
  return (data ?? []).map((r) => r.shared_with);
}

export async function getFlashcardSetSharesForFriend(friendUserId: string): Promise<string[]> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("flashcard_set_shares")
    .select("set_id")
    .eq("owner_id", userId)
    .eq("shared_with", friendUserId);
  if (error) throw error;
  return (data ?? []).map((r) => r.set_id);
}

export async function shareFlashcardSet(setId: string, friendUserId: string) {
  const ownerId = await currentUserId();
  const { error } = await supabase
    .from("flashcard_set_shares")
    .upsert({ set_id: setId, owner_id: ownerId, shared_with: friendUserId }, { onConflict: "set_id,shared_with", ignoreDuplicates: true });
  if (error) throw error;
}

export async function unshareFlashcardSet(setId: string, friendUserId: string) {
  const { error } = await supabase.from("flashcard_set_shares").delete().eq("set_id", setId).eq("shared_with", friendUserId);
  if (error) throw error;
}

export async function getSharedFlashcardSetsWithMe(): Promise<SharedFlashcardSet[]> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("flashcard_set_shares")
    .select("created_at, flashcard_sets(*), owner:public_profiles!flashcard_set_shares_owner_id_fkey(id, username, avatar_url, public_id)")
    .eq("shared_with", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []).filter((r: any) => r.flashcard_sets && r.owner);
  const sets = await withCards(rows.map((r: any) => r.flashcard_sets));
  return rows.map((r: any, i: number) => ({ set: sets[i], owner: rowToProfile(r.owner) }));
}

const MODULE_COLORS = ["#FF6B5B", "#8C8FE0", "#6B9080", "#FFC93C", "#5AA9E6"];

// Создание модуля сразу со всеми карточками — как экран создания в Quizlet:
// студент вводит термин + определение для каждой карточки, потом жмёт "Создать" один раз.
export async function createFlashcardSet(title: string, pairs: { front: string; back: string }[]): Promise<FlashcardSet> {
  const ownerId = await currentUserId();
  const color = MODULE_COLORS[Math.floor(Math.random() * MODULE_COLORS.length)];

  const { data: set, error } = await supabase
    .from("flashcard_sets")
    .insert({ owner_id: ownerId, title, color })
    .select()
    .single();
  if (error) throw error;

  if (pairs.length > 0) {
    const { error: cardsError } = await supabase
      .from("flashcards")
      .insert(pairs.map((p) => ({ set_id: set.id, owner_id: ownerId, front: p.front, back: p.back })));
    if (cardsError) throw cardsError;
  }

  return { id: set.id, title: set.title, color: set.color, cards: pairs.map((p, i) => ({ id: `tmp-${i}`, ...p })) };
}

// Редактирование модуля: новое название + полный список карточек (старые заменяются новыми —
// так проще, чем вычислять, какие карточки изменились, а какие удалены)
export async function updateFlashcardSet(id: string, title: string, pairs: { front: string; back: string }[]) {
  const ownerId = await currentUserId();
  const { error } = await supabase.from("flashcard_sets").update({ title }).eq("id", id);
  if (error) throw error;
  const { error: deleteError } = await supabase.from("flashcards").delete().eq("set_id", id);
  if (deleteError) throw deleteError;
  if (pairs.length > 0) {
    const { error: insertError } = await supabase
      .from("flashcards")
      .insert(pairs.map((p) => ({ set_id: id, owner_id: ownerId, front: p.front, back: p.back })));
    if (insertError) throw insertError;
  }
}

// Карточки удалятся вместе с модулем (on delete cascade)
export async function deleteFlashcardSet(id: string) {
  const { error } = await supabase.from("flashcard_sets").delete().eq("id", id);
  if (error) throw error;
}

// Одна карточка в существующий модуль — «В карточку» из выделенного текста конспекта
export async function addFlashcard(setId: string, front: string, back: string) {
  const ownerId = await currentUserId();
  const { error } = await supabase.from("flashcards").insert({ set_id: setId, owner_id: ownerId, front, back });
  if (error) throw error;
}

// Список своих модулей без карточек — для выбора, куда добавить карточку
export async function getFlashcardSetTitles(): Promise<{ id: string; title: string }[]> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("flashcard_sets")
    .select("id, title")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// --- Группы ---

function rowToGroup(g: any): Group {
  return {
    id: g.id,
    name: g.name,
    university: g.university ?? undefined,
    // group_members(count) — PostgREST считает участников прямо в запросе: [{ count: 5 }]
    memberCount: g.group_members?.[0]?.count ?? 1,
    inviteCode: g.invite_code,
    ownerId: g.owner_id,
  };
}

// Группы, в которых я состою (свои и те, куда вступил) — остальные база не покажет
export async function getGroups(): Promise<Group[]> {
  const { data, error } = await supabase
    .from("groups")
    .select("*, group_members(count)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToGroup);
}

export async function getGroup(id: string): Promise<Group | undefined> {
  const { data, error } = await supabase.from("groups").select("*, group_members(count)").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? rowToGroup(data) : undefined;
}

// Код без похожих символов (0/O, 1/I/L), чтобы его было легко продиктовать
function generateInviteCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export async function addGroup(name: string, university?: string): Promise<Group> {
  const ownerId = await currentUserId();
  const { data, error } = await supabase
    .from("groups")
    .insert({ owner_id: ownerId, name, university: university ?? null, invite_code: generateInviteCode() })
    .select()
    .single();
  if (error) throw error;
  return rowToGroup(data);
}

// Вступление по коду — через функцию в базе (join_group_by_code), потому что чужую группу
// до вступления не видно. Возвращает id группы
export async function joinGroupByCode(code: string): Promise<string> {
  const { data, error } = await supabase.rpc("join_group_by_code", { code: code.trim() });
  if (error) {
    if (error.code === "P0002") throw new Error("Группа с таким кодом не найдена — проверьте код");
    throw error;
  }
  return data as string;
}

// Добавить своего друга в группу (может любой участник) — через функцию в базе add_friend_to_group
export async function addFriendToGroup(groupId: string, friendUserId: string) {
  const { error } = await supabase.rpc("add_friend_to_group", { gid: groupId, friend: friendUserId });
  if (error) throw error;
}

export async function getGroupMembers(groupId: string): Promise<GroupMember[]> {
  const { data, error } = await supabase
    .from("group_members")
    .select("role, joined_at, public_profiles(id, username, avatar_url, public_id)")
    .eq("group_id", groupId)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return (data ?? [])
    .filter((r: any) => r.public_profiles)
    .map((r: any) => ({ role: r.role, profile: rowToProfile(r.public_profiles) }));
}

export async function leaveGroup(groupId: string) {
  const userId = await currentUserId();
  const { error } = await supabase.from("group_members").delete().eq("group_id", groupId).eq("user_id", userId);
  if (error) throw error;
}

export async function removeGroupMember(groupId: string, userId: string) {
  const { error } = await supabase.from("group_members").delete().eq("group_id", groupId).eq("user_id", userId);
  if (error) throw error;
}

// Участники и сообщения удалятся вместе с группой (on delete cascade)
export async function deleteGroup(groupId: string) {
  const { error } = await supabase.from("groups").delete().eq("id", groupId);
  if (error) throw error;
}

// --- Чат группы ---

function rowToMessage(r: any): GroupMessage {
  return {
    id: r.id,
    groupId: r.group_id,
    authorId: r.author_id ?? undefined,
    body: r.body ?? "",
    attachment: r.attachment ?? undefined,
    createdAt: r.created_at,
  };
}

export const MESSAGES_PAGE = 50;

// Последние сообщения (или более ранние, чем before) — в порядке от старых к новым
export async function getGroupMessages(groupId: string, before?: string): Promise<GroupMessage[]> {
  let query = supabase
    .from("group_messages")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(MESSAGES_PAGE);
  if (before) query = query.lt("created_at", before);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(rowToMessage).reverse();
}

export async function sendGroupMessage(groupId: string, body: string, attachment?: ChatAttachment): Promise<GroupMessage> {
  const authorId = await currentUserId();
  const { data, error } = await supabase
    .from("group_messages")
    .insert({ group_id: groupId, author_id: authorId, body, attachment: attachment ?? null })
    .select()
    .single();
  if (error) throw error;
  return rowToMessage(data);
}

// Свой файл удаляем из хранилища вместе с сообщением; чужой (создатель группы удаляет
// сообщение участника) удалить нельзя — хранилище пускает только в свою папку
export async function deleteGroupMessage(message: GroupMessage) {
  const { error } = await supabase.from("group_messages").delete().eq("id", message.id);
  if (error) throw error;
  if (message.attachment && message.authorId === (await currentUserId())) {
    await removeUploadedFiles([message.attachment.url]);
  }
}

// Новые и удалённые сообщения в реальном времени (Supabase Realtime).
// Правила доступа действуют и здесь: придут только сообщения групп, где я участник
export function subscribeToGroupMessages(
  groupId: string,
  handlers: { onInsert: (m: GroupMessage) => void; onDelete: (id: string) => void }
): () => void {
  // Уникальное имя канала: supabase.channel() с уже занятым именем вернёт старый, уже подписанный
  // канал, и добавить к нему обработчики нельзя (ошибка "cannot add callbacks after subscribe()")
  const channel = supabase
    .channel(`group-messages-${groupId}-${crypto.randomUUID()}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "group_messages", filter: `group_id=eq.${groupId}` },
      (payload) => handlers.onInsert(rowToMessage(payload.new))
    )
    // Для удалений Supabase присылает только id (фильтр по группе не работает) — лишние id просто не найдутся
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "group_messages" }, (payload) => {
      const id = (payload.old as any)?.id;
      if (id) handlers.onDelete(id);
    })
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

// --- Профиль (юзернейм + аватарка) ---

export async function getMyPublicProfile(): Promise<PublicProfile | undefined> {
  const userId = await currentUserId();
  const { data, error } = await supabase.from("public_profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data ? rowToProfile(data) : undefined;
}

function rowToProfile(row: any): PublicProfile {
  return { id: row.id, username: row.username, avatarUrl: row.avatar_url ?? undefined, publicId: Number(row.public_id) };
}

// Для отображения: 12345678 → "1234 5678", так легче продиктовать
export function formatPublicId(publicId: number): string {
  const s = String(publicId);
  return `${s.slice(0, 4)} ${s.slice(4)}`;
}

export async function createMyPublicProfile(username: string, avatarUrl?: string): Promise<PublicProfile> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("public_profiles")
    .insert({ id: userId, username, avatar_url: avatarUrl ?? null })
    .select()
    .single();
  if (error) throw error;
  return rowToProfile(data);
}

// Правила юзернейма — те же, что проверяет база (public_profiles_username_format)
export function cleanUsername(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 30);
}

export function profileErrorMessage(err: any): string {
  if (err?.code === "23505") return "Этот юзернейм уже занят — придумайте другой";
  if (err?.code === "23514") return "Юзернейм: только латинские буквы, цифры и _, до 30 символов";
  return err?.message ?? "Не получилось сохранить профиль";
}

// Чужой публичный профиль — например, владельца тетради, которую открыли мне
export async function getPublicProfile(userId: string): Promise<PublicProfile | undefined> {
  const { data, error } = await supabase.from("public_profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data ? rowToProfile(data) : undefined;
}

// Смена юзернейма и/или аватарки. avatarUrl: undefined — не трогаем, null — убрать.
// Старую аватарку удаляем из хранилища. ID при этом не меняется (его держит триггер в базе)
export async function updateMyPublicProfile(
  changes: { username?: string; avatarUrl?: string | null },
  previousAvatarUrl?: string
): Promise<PublicProfile> {
  const userId = await currentUserId();
  const update: Record<string, unknown> = {};
  if (changes.username !== undefined) update.username = changes.username;
  if (changes.avatarUrl !== undefined) update.avatar_url = changes.avatarUrl;
  const { data, error } = await supabase.from("public_profiles").update(update).eq("id", userId).select().single();
  if (error) throw error;
  if (changes.avatarUrl !== undefined && previousAvatarUrl && previousAvatarUrl !== changes.avatarUrl) {
    await removeUploadedFiles([previousAvatarUrl]);
  }
  return rowToProfile(data);
}

// Пол хранится в приватном профиле (не показывается другим пользователям, в отличие от public_profiles)
export async function updateMyGender(gender: "male" | "female" | "unspecified") {
  const userId = await currentUserId();
  const { error } = await supabase.from("profiles").update({ gender }).eq("id", userId);
  if (error) throw error;
}

// --- Друзья: поиск по юзернейму или ID среди реальных пользователей + заявки ---

// Если ввели 8 цифр (можно с пробелами, "#" или "ID" впереди) — ищем точное совпадение по ID,
// иначе — по части юзернейма
export async function searchUsers(query: string): Promise<PublicProfile[]> {
  const userId = await currentUserId();
  const digits = query.replace(/^\s*(id|#)\s*:?\s*/i, "").replace(/[\s-]/g, "");
  if (/^\d{8}$/.test(digits)) {
    const { data, error } = await supabase
      .from("public_profiles")
      .select("*")
      .eq("public_id", Number(digits))
      .neq("id", userId)
      .limit(1);
    if (error) throw error;
    return (data ?? []).map(rowToProfile);
  }

  const safe = query.replace(/^@/, "").replace(/[,()%]/g, " ").trim();
  if (!safe) return [];
  const { data, error } = await supabase
    .from("public_profiles")
    .select("*")
    .ilike("username", `%${safe}%`)
    .neq("id", userId)
    .limit(10);
  if (error) throw error;
  return (data ?? []).map(rowToProfile);
}

export async function sendFriendRequest(toId: string) {
  const fromId = await currentUserId();
  const { error } = await supabase.from("friend_requests").insert({ from_id: fromId, to_id: toId });
  if (error) throw error;
}

export async function getIncomingRequests(): Promise<IncomingRequest[]> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("friend_requests")
    .select("id, from_id, public_profiles!friend_requests_from_id_fkey(id, username, avatar_url, public_id)")
    .eq("to_id", userId)
    .eq("status", "pending");
  if (error) throw error;
  return (data ?? [])
    .filter((r: any) => r.public_profiles)
    .map((r: any) => ({
      id: r.id,
      fromProfile: rowToProfile(r.public_profiles),
    }));
}

// Сколько заявок в друзья ждут ответа — для красного счётчика в боковой панели.
// head: true — база возвращает только число, без самих строк
export async function getIncomingRequestCount(): Promise<number> {
  const userId = await currentUserId();
  const { count, error } = await supabase
    .from("friend_requests")
    .select("id", { count: "exact", head: true })
    .eq("to_id", userId)
    .eq("status", "pending");
  if (error) throw error;
  return count ?? 0;
}

// Страница «Друзья» сообщает боковой панели, что заявки изменились (приняли/отклонили),
// чтобы счётчик обновился сразу, а не при следующей проверке
export const FRIEND_REQUESTS_CHANGED = "friend-requests-changed";
export function notifyFriendRequestsChanged() {
  window.dispatchEvent(new Event(FRIEND_REQUESTS_CHANGED));
}

export async function acceptFriendRequest(requestId: string) {
  const { error } = await supabase.from("friend_requests").update({ status: "accepted" }).eq("id", requestId);
  if (error) throw error;
}

export async function declineFriendRequest(requestId: string) {
  const { error } = await supabase.from("friend_requests").delete().eq("id", requestId);
  if (error) throw error;
}

// Дружба — это принятая заявка, поэтому "удалить из друзей" = удалить заявку (может любая сторона).
// Заодно закрываем доступ к тетрадям, которыми вы делились друг с другом
export async function removeFriend(friendshipId: string, friendUserId: string) {
  const userId = await currentUserId();
  const { error } = await supabase.from("friend_requests").delete().eq("id", friendshipId);
  if (error) throw error;
  await supabase
    .from("notebook_shares")
    .delete()
    .or(`and(owner_id.eq.${userId},shared_with.eq.${friendUserId}),and(owner_id.eq.${friendUserId},shared_with.eq.${userId})`);
  await supabase
    .from("flashcard_set_shares")
    .delete()
    .or(`and(owner_id.eq.${userId},shared_with.eq.${friendUserId}),and(owner_id.eq.${friendUserId},shared_with.eq.${userId})`);
}

export async function getFriends(): Promise<Friend[]> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("friend_requests")
    .select(
      "id, from_id, to_id, from_profile:public_profiles!friend_requests_from_id_fkey(id, username, avatar_url, public_id), to_profile:public_profiles!friend_requests_to_id_fkey(id, username, avatar_url, public_id)"
    )
    .eq("status", "accepted")
    .or(`from_id.eq.${userId},to_id.eq.${userId}`);
  if (error) throw error;
  return (data ?? [])
    .map((r: any) => {
      const otherIsFrom = r.to_id === userId;
      const p = otherIsFrom ? r.from_profile : r.to_profile;
      if (!p) return null;
      return { id: r.id, profile: rowToProfile(p) };
    })
    .filter(Boolean) as Friend[];
}
