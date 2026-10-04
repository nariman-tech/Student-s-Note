import DOMPurify from "dompurify";
import { isUploadedFileUrl } from "./upload";

// Очистка HTML чужого конспекта перед показом. Свой конспект вставляется как есть, а чужой
// мог быть сохранён в обход приложения (напрямую через API) и содержать <script>, onerror="…"
// и т.п. — без очистки такой код выполнился бы от имени того, кто открыл тетрадь.
//
// Разрешаем то, что создаёт сам редактор: форматирование, стили, картинки, data-атрибуты,
// а <iframe> — только для PDF из нашего хранилища (так показываются вложенные PDF).
DOMPurify.addHook("uponSanitizeElement", (node, data) => {
  if (data.tagName !== "iframe") return;
  const src = (node as Element).getAttribute("src") ?? "";
  // Встроенный PDF — только из наших хранилищ (Supabase Storage или Backblaze через Worker)
  if (!isUploadedFileUrl(src) || !/\.pdf($|\?)/i.test(src)) node.parentNode?.removeChild(node);
});

export function sanitizeNoteHtml(html: string): string {
  return DOMPurify.sanitize(html, { ADD_TAGS: ["iframe"], ADD_ATTR: ["contenteditable", "title"] });
}
