export interface User {
  id: string;
  name: string;
  avatarUrl?: string;
  email: string;
}

export interface Notebook {
  id: string;
  title: string;
  iconEmoji: string;
  coverImageUrl?: string; // своя обложка, которую загрузил студент — приоритетнее iconEmoji
  spineColor: string; // цвет "корешка" тетради в списке
  courseTag?: string;
  updatedAt: string;
  ownerId: string;
  groupId?: string; // тетрадь группы — её дописывают все участники
}

export interface NoteAttachment {
  id: string;
  type: "image" | "video" | "file";
  url: string;
  name: string;
}

// Страница тетради («Лекция 1», «Семинар»…). В списке страниц — без содержимого (PageSummary),
// содержимое загружается, когда страницу открывают (NotePage)
export interface PageSummary {
  id: string;
  title: string;
  position: number;
}

export interface NotePage extends PageSummary {
  notebookId: string;
  updatedAt: string; // точное время последнего сохранения — чтобы не затереть чужие правки
  updatedBy?: string; // кто последним изменил (для тетрадей группы)
  content: string; // включает встроенные картинки, файлы и PDF как защищённые блоки — удаляются только крестиком
  attachments: NoteAttachment[]; // скриншоты решений (из рисования) — список внизу
}

export interface FlashcardSet {
  id: string;
  title: string;
  notebookId?: string;
  color: string; // цвет стопки в сетке модулей
  cards: Flashcard[];
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
}

export interface Group {
  id: string;
  name: string;
  university?: string;
  memberCount: number;
  inviteCode: string;
  ownerId: string;
}

export interface GroupMember {
  profile: PublicProfile;
  role: "owner" | "member";
}

export interface ChatAttachment {
  url: string; // файл в Supabase Storage
  name: string;
  type: "image" | "file";
  size: number;
}

export interface GroupMessage {
  id: string;
  groupId: string;
  authorId?: string; // пусто, если автор удалил аккаунт
  body: string;
  attachment?: ChatAttachment;
  createdAt: string;
}

export interface PublicProfile {
  id: string;
  username: string;
  avatarUrl?: string;
  publicId: number; // короткий ID из 8 цифр — для поиска друзей, не меняется (выдаёт база)
}

export interface Friend {
  id: string; // id заявки (friend_requests) — по ней и принимаем/удаляем
  profile: PublicProfile; // другая сторона дружбы
}

export interface IncomingRequest {
  id: string;
  fromProfile: PublicProfile;
}

export interface SolvedTask {
  id: string;
  sourceImageUrl: string;
  solutionImageUrl: string;
  noteId: string;
}

// Чужая тетрадь, которую друг открыл мне на чтение
export interface SharedNotebook {
  notebook: Notebook;
  owner: PublicProfile;
}

// Чужой модуль флеш-карт, который друг открыл мне для изучения
export interface SharedFlashcardSet {
  set: FlashcardSet;
  owner: PublicProfile;
}

// Результат поиска: тетрадь + кусочек текста, где нашлось (найденные слова обёрнуты в ⟦ ⟧)
export interface SearchResult {
  id: string;
  title: string;
  iconEmoji: string;
  ownerId: string;
  pageId?: string; // страница, где нашлось (если нашлось в тексте, а не в названии тетради)
  pageTitle?: string;
  snippet?: string;
}
