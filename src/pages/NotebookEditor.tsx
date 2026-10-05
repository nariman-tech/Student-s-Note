import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { track } from "../lib/analytics";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  getNotebook,
  getPages,
  getPage,
  getAllPages,
  createPage,
  savePage,
  renamePage,
  deletePage,
  reorderPages,
  renameNotebook,
  deleteNotebook,
  updateNotebookCover,
  getNotebookShares,
  shareNotebook,
  unshareNotebook,
  currentUserId,
  getPublicProfile,
  getGroup,
  subscribeToPage,
  PageConflictError,
} from "../lib/store";
import { uploadCanvas, uploadFile, uploadImage, removeFileIfUnused } from "../lib/upload";
import { sanitizeNoteHtml } from "../lib/sanitize";
import { getShareToken, enableShareLink, disableShareLink, notebookLink } from "../lib/links";
import { exportToPdf } from "../lib/pdf";
// Рисование тянет за собой html2canvas (~200 КБ) — грузим его, только когда нажали «Рисовать»
const DrawingOverlay = lazy(() => import("../components/DrawingOverlay"));
import FriendsShareModal from "../components/FriendsShareModal";
import ConfirmDialog from "../components/ConfirmDialog";
import PageTabs from "../components/PageTabs";
import CardFromSelectionModal from "../components/CardFromSelectionModal";
import { Notebook, NoteAttachment, NotePage, PageSummary } from "../types";

const HIGHLIGHT_COLORS = [
  { name: "розовый", hex: "#FFC9E3" },
  { name: "жёлтый", hex: "#FFF176" },
  { name: "голубой", hex: "#AEE2FF" },
];

const TEXT_COLORS = [
  { name: "чёрный", hex: "#1B2340" },
  { name: "красный", hex: "#E03131" },
  { name: "оранжевый", hex: "#F08C00" },
  { name: "зелёный", hex: "#2F9E44" },
  { name: "синий", hex: "#1971C2" },
  { name: "фиолетовый", hex: "#9C36B5" },
  { name: "розовый", hex: "#E64980" },
];

export default function NotebookEditor() {
  const { id } = useParams();
  const navigate = useNavigate();

  const editorRef = useRef<HTMLDivElement>(null);
  const noteAreaRef = useRef<HTMLDivElement>(null);

  const [notebook, setNotebook] = useState<Notebook | undefined>(undefined);
  const [notFound, setNotFound] = useState(false);
  const [attachments, setAttachments] = useState<NoteAttachment[]>([]);
  const [drawingOpen, setDrawingOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [uploading, setUploading] = useState(false);
  const [editingTitle, setEditingTitle] = useState<string | null>(null); // null — не редактируем
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Чужая тетрадь, открытая мне другом, — только чтение
  const [readOnlyOwner, setReadOnlyOwner] = useState<string | null>(null); // юзернейм владельца
  const readOnly = readOnlyOwner !== null;
  // Тетрадь группы: пишут все участники; удалить и делиться ею вне группы может только автор
  const [isOwner, setIsOwner] = useState(false);
  const [groupInfo, setGroupInfo] = useState<{ id: string; name: string } | null>(null);
  // Чужой HTML (тетрадь друга или тетрадь группы, где пишут другие) показываем только после очистки
  const needsSanitize = readOnly || groupInfo !== null;
  // Защита от затирания чужих правок: время последнего сохранения открытой страницы
  const pageVersion = useRef<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [lastEditor, setLastEditor] = useState<string | null>(null); // «изменено @anna» в тетради группы
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState("");
  const [toolbarPos, setToolbarPos] = useState<{ x: number; y: number } | null>(null);
  const saveTimer = useRef<number>();

  // Страницы тетради: список (без содержимого) и открытая сейчас страница (?page=<id> в адресе)
  const [searchParams, setSearchParams] = useSearchParams();
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [page, setPage] = useState<NotePage | null>(null);
  const requestedPageId = searchParams.get("page");
  // Для отложенного автосохранения: какая страница и с какими вложениями ждёт сохранения
  const pendingSave = useRef<{ page: { id: string; notebookId: string }; attachments: NoteAttachment[] } | null>(null);
  // Файлы, убранные крестиком: удаляем из хранилища после того, как страница без них сохранилась
  const filesToCleanUp = useRef<string[]>([]);
  // PDF всей тетради: все страницы с содержимым, отрисованные только для печати
  const [printPages, setPrintPages] = useState<NotePage[] | null>(null);

  useEffect(() => {
    if (!id) return;
    // cancelled — загрузку прервали (ушли со страницы или React в режиме разработки перезапустил
    // эффект): такая загрузка не должна ни менять состояние, ни создавать страницы
    let cancelled = false;
    (async () => {
      const nb = await getNotebook(id);
      if (cancelled) return;
      if (!nb) {
        setNotFound(true);
        return;
      }
      const owner = nb.ownerId === (await currentUserId());
      if (nb.groupId) {
        // Тетрадь группы открылась — значит, я участник группы и могу её дописывать
        const group = await getGroup(nb.groupId).catch(() => undefined);
        if (cancelled) return;
        setGroupInfo({ id: nb.groupId, name: group?.name ?? "группы" });
      } else if (!owner) {
        const ownerProfile = await getPublicProfile(nb.ownerId).catch(() => undefined);
        if (cancelled) return;
        setReadOnlyOwner(ownerProfile?.username ?? "друг");
      }
      setIsOwner(owner);
      const canEdit = owner || !!nb.groupId;
      let list = await getPages(id);
      if (cancelled) return;
      // Страниц нет (тетрадь создана до появления страниц или первая страница не создалась) —
      // создаём первую, чтобы сразу можно было писать
      if (list.length === 0 && canEdit) list = [await createPage(id, "Страница 1", 0)];
      if (cancelled) return;
      setPages(list);
      setNotebook(nb);
    })().catch((err) => {
      console.error("Не получилось открыть тетрадь", err);
      if (!cancelled) setNotFound(true);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Какая страница открыта: из адреса (?page=…), иначе первая
  const currentPageId = pages.some((p) => p.id === requestedPageId) ? requestedPageId : pages[0]?.id ?? null;

  // Загрузка содержимого страницы при переключении
  useEffect(() => {
    if (!currentPageId || !notebook) return;
    let cancelled = false;
    (async () => {
      await flushSave(); // несохранённые правки предыдущей страницы — сначала сохраняем
      const loaded = await getPage(currentPageId);
      if (cancelled || !loaded) return;
      setPage(loaded);
      applyPageContent(loaded);
      setConflict(false);
      setSaveState(loaded.content ? "saved" : "idle");
    })().catch((err) => console.error("Не получилось открыть страницу", err));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPageId, notebook?.id]);

  // Показать содержимое страницы в редакторе (при открытии, по кнопке «загрузить их версию»,
  // и когда правки другого участника пришли в реальном времени)
  function applyPageContent(loaded: NotePage) {
    pageVersion.current = loaded.updatedAt;
    setAttachments(loaded.attachments);
    if (editorRef.current) {
      editorRef.current.innerHTML = needsSanitize ? sanitizeNoteHtml(loaded.content) : loaded.content;
    }
    if (groupInfo && loaded.updatedBy) {
      getPublicProfile(loaded.updatedBy)
        .then((p) => setLastEditor(p?.username ?? null))
        .catch(() => {});
    }
  }

  // Правки открытой страницы от других участников группы — сразу.
  // Если я сейчас ничего не печатаю — просто показываем новую версию; если печатаю — конфликт.
  // Только в тетрадях групп: в личной тетради пишу только я, а каждое автосохранение тратило бы
  // лимит сообщений Realtime. Две мои вкладки с одной тетрадью по-прежнему не затрут друг друга —
  // это ловит проверка версии при сохранении (savePage → PageConflictError)
  useEffect(() => {
    if (!page || readOnly || !groupInfo) return;
    return subscribeToPage(page.id, (updated) => {
      if (updated.updatedAt === pageVersion.current) return; // это моё же сохранение
      if (pendingSave.current) {
        window.clearTimeout(saveTimer.current);
        setConflict(true);
      } else {
        applyPageContent(updated);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.id, readOnly, groupInfo?.id]);

  // Кнопки при конфликте
  async function handleConflictTakeTheirs() {
    if (!page) return;
    pendingSave.current = null;
    const fresh = await getPage(page.id);
    if (fresh) applyPageContent(fresh);
    setConflict(false);
    setSaveState("saved");
  }

  async function handleConflictKeepMine() {
    if (!page) return;
    const pending = pendingSave.current ?? { page: { id: page.id, notebookId: page.notebookId }, attachments };
    pendingSave.current = null;
    pageVersion.current = await savePage(pending.page, editorRef.current?.innerHTML ?? "", pending.attachments, null, true);
    setConflict(false);
    setSaveState("saved");
  }

  function selectPage(pageId: string) {
    setSearchParams({ page: pageId }, { replace: true });
  }

  function scheduleSave(nextAttachments = attachments) {
    if (!page || readOnly) return;
    pendingSave.current = { page: { id: page.id, notebookId: page.notebookId }, attachments: nextAttachments };
    setSaveState("saving");
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      flushSave().catch((err) => console.error(err));
    }, 700);
  }

  // Сохранить отложенные правки прямо сейчас (перед переключением страницы, PDF, уходом со страницы)
  async function flushSave() {
    window.clearTimeout(saveTimer.current);
    const pending = pendingSave.current;
    if (!pending || conflictRef.current) return;
    pendingSave.current = null;
    // Файлы, убранные ДО этого момента, — их уже нет в тексте, который сохраняем сейчас.
    // Берём список именно здесь: если взять его после сохранения, туда могут попасть файлы,
    // убранные, пока шло сохранение (их ещё нет в сохранённом тексте — проверка решила бы,
    // что файл используется, и он навсегда остался бы в хранилище)
    const urls = filesToCleanUp.current.splice(0);
    const html = editorRef.current?.innerHTML ?? "";
    try {
      pageVersion.current = await savePage(pending.page, html, pending.attachments, pageVersion.current);
      setSaveState("saved");
      urls.forEach((url) => removeFileIfUnused(url).catch(() => {}));
    } catch (err) {
      filesToCleanUp.current.unshift(...urls); // не сохранилось — проверим эти файлы при следующем сохранении
      if (err instanceof PageConflictError) {
        // Страницу успели изменить — ничего не затираем, спрашиваем, чью версию оставить
        pendingSave.current = pending;
        setConflict(true);
        return;
      }
      pendingSave.current = pending; // не сохранилось (например, нет интернета) — попробуем при следующем изменении
      throw err;
    }
  }

  // flushSave вызывается и из «старых» замыканий (таймер, уход со страницы) — читаем конфликт через ref
  const conflictRef = useRef(false);
  conflictRef.current = conflict;

  // Уходим из тетради — не теряем последние секунды набора
  useEffect(() => {
    return () => {
      flushSave().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleExportPdf() {
    if (!notebook) return;
    await flushSave().catch(() => {});
    setPrintPages(await getAllPages(notebook.id));
    track("pdf_export");
  }

  // Когда все страницы отрисованы для печати — открываем окно печати («Сохранить как PDF»),
  // после печати возвращаем обычный вид (Ctrl+P снова печатает только открытую страницу)
  useEffect(() => {
    if (!printPages || !notebook) return;
    const reset = () => setPrintPages(null);
    window.addEventListener("afterprint", reset, { once: true });
    exportToPdf(notebook.title);
    return () => window.removeEventListener("afterprint", reset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printPages]);

  // --- Страницы: добавить, переименовать, сдвинуть, удалить ---

  const [deletingPageId, setDeletingPageId] = useState<string | null>(null);

  // --- «В карточку»: выделенный текст → флеш-карта ---
  const [cardText, setCardText] = useState<string | null>(null);
  const [cardToast, setCardToast] = useState<string | null>(null);

  function handleMakeCard(e: React.MouseEvent) {
    e.preventDefault(); // не снимать выделение до того, как прочитали текст
    const text = window.getSelection()?.toString().trim() ?? "";
    setToolbarPos(null);
    if (text) setCardText(text);
  }

  function handleCardSaved(setTitle: string) {
    setCardToast(setTitle);
    window.setTimeout(() => setCardToast(null), 5000);
  }

  // На телефоне текст выделяют пальцем — mouseup там не приходит, следим за изменением выделения
  useEffect(() => {
    let timer: number | undefined;
    const onChange = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(handleSelect, 150);
    };
    document.addEventListener("selectionchange", onChange);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("selectionchange", onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAddPage() {
    if (!notebook) return;
    try {
      await flushSave();
      const position = pages.length === 0 ? 0 : Math.max(...pages.map((p) => p.position)) + 1;
      const created = await createPage(notebook.id, `Страница ${pages.length + 1}`, position);
      setPages((list) => [...list, created]);
      selectPage(created.id);
    } catch (err: any) {
      setUploadError(err?.message ?? "Не получилось добавить страницу");
    }
  }

  async function handleRenamePage(pageId: string, title: string) {
    const previous = pages;
    setPages((list) => list.map((p) => (p.id === pageId ? { ...p, title } : p)));
    if (page?.id === pageId) setPage({ ...page, title });
    try {
      await renamePage(pageId, title);
    } catch (err: any) {
      setPages(previous);
      setUploadError(err?.message ?? "Не получилось переименовать страницу");
    }
  }

  async function handleMovePage(pageId: string, direction: -1 | 1) {
    const index = pages.findIndex((p) => p.id === pageId);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= pages.length) return;
    const previous = pages;
    const next = [...pages];
    [next[index], next[target]] = [next[target], next[index]];
    setPages(next.map((p, i) => ({ ...p, position: i })));
    try {
      await reorderPages(next.map((p) => p.id));
    } catch (err: any) {
      setPages(previous);
      setUploadError(err?.message ?? "Не получилось изменить порядок страниц");
    }
  }

  async function handleDeletePage(pageId: string) {
    if (page?.id === pageId) {
      window.clearTimeout(saveTimer.current);
      pendingSave.current = null; // правки удаляемой страницы сохранять уже незачем
    }
    const target = page?.id === pageId ? page : await getPage(pageId);
    if (!target) return;
    await deletePage(target);
    const index = pages.findIndex((p) => p.id === pageId);
    const rest = pages.filter((p) => p.id !== pageId);
    setPages(rest);
    const neighbour = rest[Math.max(0, index - 1)];
    if (neighbour) selectPage(neighbour.id);
  }

  // Вставляем узел в место, где стоит курсор в тексте, и оставляем каретку сразу после него,
  // чтобы можно было продолжать писать. Общая логика для картинок и файлов/PDF ниже.
  function insertNodeAtCursor(node: HTMLElement) {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();

    const selection = window.getSelection();
    let range: Range;
    if (selection && selection.rangeCount > 0 && editor.contains(selection.anchorNode)) {
      range = selection.getRangeAt(0);
    } else {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    range.deleteContents();
    range.insertNode(node);

    const br = document.createElement("br");
    node.after(br);

    const newRange = document.createRange();
    newRange.setStartAfter(br);
    newRange.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(newRange);

    scheduleSave();
  }

  // Вставляем картинку прямо в место, где стоит курсор — можно продолжать писать
  // текст и до, и после неё. Картинка — неразрушаемый блок (contenteditable=false):
  // обычный набор/удаление текста рядом с ней её не затронет, убрать можно только крестиком.
  function insertImageAtCursor(dataUrl: string, name: string) {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("contenteditable", "false");
    wrapper.setAttribute("data-note-image", "true");
    wrapper.style.cssText = "position:relative;margin:12px 0;border-radius:10px;overflow:hidden;background:#F7F8F5;";

    const img = document.createElement("img");
    img.src = dataUrl;
    img.alt = name;
    img.style.cssText = "width:100%;max-height:480px;object-fit:contain;display:block;";
    wrapper.appendChild(img);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "✕";
    delBtn.title = "Удалить картинку";
    delBtn.setAttribute("data-action", "remove-image");
    delBtn.style.cssText =
      "position:absolute;top:8px;right:8px;width:28px;height:28px;border-radius:9999px;background:rgba(27,35,64,.85);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;cursor:pointer;border:none;";
    wrapper.appendChild(delBtn);

    insertNodeAtCursor(wrapper);
  }

  // Вставляем файл/PDF прямо в место, где стоит курсор — так же, как картинку.
  // PDF показывается встроенным просмотрщиком (родной браузерный рендер) —
  // страницы можно листать и скроллить прямо внутри конспекта, не открывая ничего отдельно.
  // Остальные файлы — карточкой с именем. Тоже неразрушаемый блок, удаляется только крестиком.
  function insertFileAtCursor(dataUrl: string, name: string, mime: string) {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("contenteditable", "false");
    wrapper.setAttribute("data-note-file", "true");
    wrapper.style.cssText =
      "position:relative;margin:12px 0;border-radius:10px;overflow:hidden;background:#F7F8F5;border:1px solid #DCE0E8;";

    if (mime === "application/pdf") {
      const header = document.createElement("div");
      header.textContent = "📄 " + name;
      header.style.cssText =
        "font-size:11px;color:rgba(27,35,64,.5);background:#F7F8F5;padding:6px 36px 6px 10px;border-bottom:1px solid #DCE0E8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      wrapper.appendChild(header);

      const iframe = document.createElement("iframe");
      iframe.src = dataUrl;
      iframe.title = name;
      iframe.style.cssText = "width:100%;height:480px;border:0;background:#fff;display:block;";
      wrapper.appendChild(iframe);
    } else {
      // Карточка — ссылка на файл в хранилище: по клику файл открывается/скачивается
      const card = document.createElement("a");
      card.href = dataUrl;
      card.target = "_blank";
      card.rel = "noopener noreferrer";
      card.setAttribute("data-file-link", "true");
      card.title = "Открыть файл";
      card.style.cssText = "display:flex;align-items:center;gap:10px;padding:12px 40px 12px 12px;color:inherit;text-decoration:none;cursor:pointer;";

      const icon = document.createElement("span");
      icon.textContent = mime.startsWith("video") ? "🎬" : "📄";
      icon.style.cssText = "font-size:20px;flex-shrink:0;";
      card.appendChild(icon);

      const label = document.createElement("span");
      label.textContent = name;
      label.style.cssText = "font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      card.appendChild(label);

      wrapper.appendChild(card);
    }

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "✕";
    delBtn.title = "Удалить";
    delBtn.setAttribute("data-action", "remove-file");
    delBtn.style.cssText =
      "position:absolute;top:8px;right:8px;width:28px;height:28px;border-radius:9999px;background:rgba(27,35,64,.85);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;cursor:pointer;border:none;";
    wrapper.appendChild(delBtn);

    insertNodeAtCursor(wrapper);
  }

  // Клик по крестику удаления картинки/файла внутри текста (делегирование — работает
  // и для только что вставленного, и для загруженного ранее из сохранённого HTML)
  function handleEditorClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;

    // Внутри редактируемого текста браузер не переходит по ссылкам сам — открываем файл вручную
    const fileLink = target.closest<HTMLAnchorElement>("a[data-file-link]");
    if (fileLink && !target.closest("[data-action]")) {
      e.preventDefault();
      window.open(fileLink.href, "_blank", "noopener,noreferrer");
      return;
    }

    if (readOnly) return;

    const removeImageBtn = target.closest('[data-action="remove-image"]');
    if (removeImageBtn) {
      e.preventDefault();
      const block = removeImageBtn.closest("[data-note-image]");
      const src = block?.querySelector("img")?.getAttribute("src");
      if (src) filesToCleanUp.current.push(src);
      block?.remove();
      scheduleSave();
      return;
    }

    const removeFileBtn = target.closest('[data-action="remove-file"]');
    if (removeFileBtn) {
      e.preventDefault();
      const block = removeFileBtn.closest("[data-note-file]");
      const src = block?.querySelector("iframe")?.getAttribute("src") ?? block?.querySelector("a[data-file-link]")?.getAttribute("href");
      if (src) filesToCleanUp.current.push(src);
      block?.remove();
      scheduleSave();
    }
  }

  // Файл сначала уходит в Supabase Storage, а в текст конспекта вставляется только ссылка на него
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;

    // Запоминаем место курсора: пока файл грузится, фокус может уйти из редактора
    const selection = window.getSelection();
    const savedRange =
      selection && selection.rangeCount > 0 && editorRef.current?.contains(selection.anchorNode)
        ? selection.getRangeAt(0).cloneRange()
        : null;

    setUploading(true);
    setUploadError("");
    try {
      const isImage = file.type.startsWith("image");
      const url = isImage ? await uploadImage(file) : await uploadFile(file);
      if (savedRange) {
        selection?.removeAllRanges();
        selection?.addRange(savedRange);
      }
      if (isImage) {
        insertImageAtCursor(url, file.name);
      } else {
        insertFileAtCursor(url, file.name, file.type || "application/octet-stream");
      }
    } catch (err: any) {
      setUploadError(err?.message ?? "Не получилось загрузить файл");
    } finally {
      setUploading(false);
      input.value = ""; // чтобы можно было выбрать тот же файл ещё раз
    }
  }

  function handleRemoveAttachment(attachmentId: string) {
    const removed = attachments.find((a) => a.id === attachmentId);
    if (removed) filesToCleanUp.current.push(removed.url);
    const next = attachments.filter((a) => a.id !== attachmentId);
    setAttachments(next);
    scheduleSave(next);
  }

  async function handleOverlayAttach(canvas: HTMLCanvasElement) {
    setUploading(true);
    setUploadError("");
    try {
      const url = await uploadCanvas(canvas);
      track("drawing_attached");
      const next = [...attachments, { id: crypto.randomUUID(), type: "image" as const, url, name: "Решение.webp" }];
      setAttachments(next);
      scheduleSave(next);
      setDrawingOpen(false);
    } catch (err: any) {
      setUploadError(err?.message ?? "Не получилось сохранить рисунок");
    } finally {
      setUploading(false);
    }
  }

  async function handleRenameSave() {
    if (editingTitle === null || !notebook) return;
    const title = editingTitle.trim();
    setEditingTitle(null);
    if (!title || title === notebook.title) return;
    const previous = notebook;
    setNotebook({ ...notebook, title, iconEmoji: title.charAt(0).toUpperCase() });
    try {
      await renameNotebook(notebook.id, title);
    } catch (err: any) {
      setNotebook(previous);
      setUploadError(err?.message ?? "Не получилось переименовать тетрадь");
    }
  }

  async function handleCoverChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const file = input.files?.[0];
    if (!file || !notebook) return;
    setUploading(true);
    setUploadError("");
    try {
      const url = await uploadImage(file, 800);
      await updateNotebookCover(notebook.id, url, notebook.coverImageUrl);
      setNotebook({ ...notebook, coverImageUrl: url });
    } catch (err: any) {
      setUploadError(err?.message ?? "Не получилось сменить обложку");
    } finally {
      setUploading(false);
      input.value = "";
    }
  }

  async function handleCoverRemove() {
    if (!notebook) return;
    try {
      await updateNotebookCover(notebook.id, null, notebook.coverImageUrl);
      setNotebook({ ...notebook, coverImageUrl: undefined });
    } catch (err: any) {
      setUploadError(err?.message ?? "Не получилось убрать обложку");
    }
  }

  async function handleDelete() {
    if (!notebook) return;
    window.clearTimeout(saveTimer.current); // чтобы отложенное автосохранение не пыталось писать в удалённую тетрадь
    pendingSave.current = null;
    await deleteNotebook(notebook.id);
    navigate("/");
  }

  function handleSelect() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setToolbarPos(null);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!editorRef.current?.contains(range.commonAncestorContainer)) {
      setToolbarPos(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      setToolbarPos(null);
      return;
    }
    setToolbarPos({ x: rect.left + rect.width / 2, y: rect.top });
  }

  function handleHighlight(e: React.MouseEvent, color: string) {
    e.preventDefault();
    document.execCommand("styleWithCSS", false, "true" as any);
    document.execCommand("hiliteColor", false, color);
    setToolbarPos(null);
    scheduleSave();
  }

  // Базовое форматирование текста — жирный/курсив/подчёркнутый/зачёркнутый и цвет шрифта.
  // preventDefault на mousedown — иначе клик по кнопке снимает выделение раньше, чем сработает execCommand
  function handleFormat(e: React.MouseEvent, command: string, value?: string) {
    e.preventDefault();
    document.execCommand("styleWithCSS", false, "true" as any);
    document.execCommand(command, false, value);
    editorRef.current?.focus();
    scheduleSave();
  }

  if (notFound) {
    return <div className="p-8">Тетрадь не найдена.</div>;
  }
  if (!notebook) {
    return <div className="p-8 text-sm text-ink/40">Загрузка…</div>;
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      {notebook.coverImageUrl && (
        // Обложка — только на экране: в PDF нужен сам конспект
        <div className="group relative mb-4 rounded-card overflow-hidden border border-line print:hidden">
          <img src={notebook.coverImageUrl} alt="Обложка" className="w-full h-40 object-cover" />
          {!readOnly && (
            <div className="absolute bottom-2 right-2 flex gap-2 md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100 transition-opacity print:hidden">
              <button
                onClick={() => coverInputRef.current?.click()}
                disabled={uploading}
                className="text-xs rounded-card bg-card/90 border border-line px-3 py-1.5 hover:border-ink/40"
              >
                🖼 Сменить обложку
              </button>
              <button
                onClick={handleCoverRemove}
                className="text-xs rounded-card bg-card/90 border border-line px-3 py-1.5 hover:border-coral hover:text-coral"
              >
                Убрать
              </button>
            </div>
          )}
        </div>
      )}
      <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={handleCoverChange} />
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-2xl">{notebook.coverImageUrl ? "📓" : notebook.iconEmoji}</span>
          {editingTitle !== null ? (
            <input
              autoFocus
              value={editingTitle}
              onChange={(e) => setEditingTitle(e.target.value)}
              onBlur={handleRenameSave}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRenameSave();
                if (e.key === "Escape") setEditingTitle(null);
              }}
              maxLength={120}
              className="text-xl font-display font-800 rounded-card border border-line px-2 py-0.5 min-w-0"
              aria-label="Название тетради"
            />
          ) : (
            <>
              <h2 className="text-xl font-display font-800 truncate">{notebook.title}</h2>
              {!readOnly && (
                <button
                  onClick={() => setEditingTitle(notebook.title)}
                  className="text-ink/30 hover:text-ink text-sm print:hidden"
                  title="Переименовать"
                  aria-label="Переименовать тетрадь"
                >
                  ✏️
                </button>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 print:hidden">
          <button
            onClick={handleExportPdf}
            className="text-sm rounded-card border border-line px-3 py-2 hover:border-ink/40"
            title="Скачать всю тетрадь в PDF (в окне печати выберите «Сохранить как PDF»)"
          >
            ⬇️ PDF
          </button>
        {!readOnly && (
        <>
          {!notebook.coverImageUrl && (
            <button
              onClick={() => coverInputRef.current?.click()}
              disabled={uploading}
              className="text-sm rounded-card border border-line px-3 py-2 hover:border-ink/40"
              title="Добавить обложку"
              aria-label="Добавить обложку"
            >
              🖼
            </button>
          )}
          {isOwner && (
          <>
          <button
            onClick={() => setShareOpen(true)}
            className="text-sm rounded-card border border-line px-3 py-2 hover:border-ink/40 flex items-center gap-1.5"
          >
            🔗 Поделиться
          </button>
          <button
            onClick={() => setDeleteOpen(true)}
            className="text-sm rounded-card border border-line px-3 py-2 hover:border-coral hover:text-coral"
            title="Удалить тетрадь"
            aria-label="Удалить тетрадь"
          >
            🗑
          </button>
          </>
          )}
        </>
        )}
        </div>
      </div>
      {deleteOpen && (
        <ConfirmDialog
          title="Удалить тетрадь?"
          text={`«${notebook.title}» удалится вместе с конспектом, картинками и файлами. Отменить это нельзя.`}
          onConfirm={handleDelete}
          onClose={() => setDeleteOpen(false)}
        />
      )}
      <p className="text-xs text-ink/40 mb-6 print:hidden">
        {readOnly && `Только чтение · тетрадь @${readOnlyOwner}`}
        {groupInfo && (
          <>
            📚 Тетрадь группы{" "}
            <button onClick={() => navigate(`/groups/${groupInfo.id}?tab=notebooks`)} className="underline hover:text-ink">
              «{groupInfo.name}»
            </button>
            {lastEditor && ` · последнее изменение: @${lastEditor}`}
            {" · "}
          </>
        )}
        {uploading && "Загружаем файл… "}
        {uploadError && <span className="text-coral">{uploadError} </span>}
        {conflict ? "Не сохранено — выберите версию выше" : saveState === "saving" && "Сохраняем…"}
        {!readOnly && saveState === "saved" && "Все изменения сохранены"}
        {!readOnly && saveState === "idle" && "Начните писать — сохранится автоматически. Выделите текст, чтобы выделить его цветом."}
      </p>

      {conflict && (
        <div role="alert" className="mb-3 rounded-card border border-coral/40 bg-coral/10 p-3 text-sm print:hidden">
          <p className="mb-2">
            ⚠️ Эту страницу только что изменил другой участник, а у вас есть несохранённые правки. Чью версию оставить?
          </p>
          <div className="flex flex-wrap gap-2">
            <button onClick={handleConflictTakeTheirs} className="text-xs rounded-card border border-line bg-card px-3 py-1.5 hover:border-ink/40">
              Загрузить их версию (мои правки пропадут)
            </button>
            <button onClick={handleConflictKeepMine} className="text-xs rounded-card bg-ink text-white px-3 py-1.5 hover:bg-ink/90">
              Сохранить мою поверх
            </button>
          </div>
        </div>
      )}

      <div className="print:hidden">
        <PageTabs
          pages={pages}
          currentId={currentPageId}
          readOnly={readOnly}
          onSelect={selectPage}
          onAdd={handleAddPage}
          onRename={handleRenamePage}
          onMove={handleMovePage}
          onDelete={setDeletingPageId}
        />
      </div>

      {/* Обычная печать (Ctrl+P) — открытая страница; кнопка «PDF» — все страницы тетради */}
      <div className={printPages ? "print:hidden" : ""}>
      {page && <h2 className="hidden print:block text-lg font-display font-700 mt-4 mb-2">{page.title}</h2>}

      {!readOnly && (
      <div className="flex items-center gap-1 mb-2 flex-wrap print:hidden">
        <button onMouseDown={(e) => handleFormat(e, "bold")} className="w-8 h-8 rounded-card border border-line hover:border-ink/40 flex items-center justify-center text-sm font-bold" title="Жирный">
          Ж
        </button>
        <button onMouseDown={(e) => handleFormat(e, "italic")} className="w-8 h-8 rounded-card border border-line hover:border-ink/40 flex items-center justify-center text-sm italic" title="Курсив">
          К
        </button>
        <button onMouseDown={(e) => handleFormat(e, "underline")} className="w-8 h-8 rounded-card border border-line hover:border-ink/40 flex items-center justify-center text-sm underline" title="Подчёркнутый">
          Ч
        </button>
        <button onMouseDown={(e) => handleFormat(e, "strikeThrough")} className="w-8 h-8 rounded-card border border-line hover:border-ink/40 flex items-center justify-center text-sm line-through" title="Зачёркнутый">
          З
        </button>
        <span className="w-px h-5 bg-line mx-1" />
        {TEXT_COLORS.map((c) => (
          <button
            key={c.hex}
            onMouseDown={(e) => handleFormat(e, "foreColor", c.hex)}
            className="w-6 h-6 rounded-full border border-line hover:scale-110 transition-transform"
            style={{ backgroundColor: c.hex }}
            title={`Цвет текста: ${c.name}`}
            aria-label={`Цвет текста: ${c.name}`}
          />
        ))}
      </div>
      )}

      <div className="relative rounded-card border border-line bg-card focus-within:border-ink/40 print:border-0 print:mt-4" ref={noteAreaRef}>
        <div
          ref={editorRef}
          // Писать можно только когда загружена именно открытая страница — иначе набранное
          // затёрлось бы содержимым, которое ещё грузится
          contentEditable={!drawingOpen && !readOnly && page !== null && page.id === currentPageId}
          suppressContentEditableWarning
          onInput={() => scheduleSave()}
          onClick={handleEditorClick}
          onMouseUp={handleSelect}
          onKeyUp={handleSelect}
          className={`w-full min-h-[280px] p-4 text-sm leading-relaxed outline-none ${
            readOnly ? "[&_[data-action]]:hidden" : "empty-placeholder"
          }`}
        />

        {drawingOpen && (
          <Suspense fallback={null}>
            <DrawingOverlay targetRef={noteAreaRef} onAttach={handleOverlayAttach} onClose={() => setDrawingOpen(false)} />
          </Suspense>
        )}

        {toolbarPos && !drawingOpen && (
          <div
            className="fixed z-40 flex items-center gap-1.5 bg-ink rounded-card px-2 py-1.5 shadow-lg -translate-x-1/2 -translate-y-full print:hidden"
            style={{ left: toolbarPos.x, top: toolbarPos.y - 8 }}
          >
            <button
              onMouseDown={handleMakeCard}
              className="text-xs text-white font-medium px-1.5 py-0.5 rounded hover:bg-white/10 whitespace-nowrap"
              title="Сделать флеш-карту из выделенного текста"
            >
              🗂 В карточку
            </button>
            {!readOnly && <span className="w-px h-4 bg-white/20" aria-hidden />}
            {!readOnly && HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c.hex}
                onMouseDown={(e) => handleHighlight(e, c.hex)}
                className="w-6 h-6 rounded-full border-2 border-white/30 hover:border-white"
                style={{ backgroundColor: c.hex }}
                aria-label={`Выделить ${c.name}`}
                title={`Выделить ${c.name}`}
              />
            ))}
          </div>
        )}
      </div>

      {!readOnly && (
      <div className="flex flex-wrap gap-3 mt-4 print:hidden">
        <label className="cursor-pointer inline-flex items-center gap-2 text-sm rounded-card border border-line px-3 py-2 hover:border-ink/40">
          📎 Прикрепить файл
          <input type="file" className="hidden" onChange={handleFileUpload} disabled={uploading} />
        </label>
        <button
          onClick={() => setDrawingOpen((v) => !v)}
          className={`inline-flex items-center gap-2 text-sm rounded-card px-3 py-2 font-medium ${
            drawingOpen ? "bg-ink text-white" : "bg-highlight text-ink hover:brightness-95"
          }`}
        >
          ✏️ {drawingOpen ? "Готово" : "Рисовать"}
        </button>
      </div>
      )}

      {attachments.length > 0 && (
        <div className="mt-6">
          <h3 className="text-xs font-medium text-ink/50 mb-2">Вложения и решения</h3>
          <div className="flex flex-col gap-3">
            {attachments.map((a) => (
              <div key={a.id} className="relative rounded-card border border-line overflow-hidden bg-card">
                {a.type === "image" ? (
                  <img src={a.url} alt={a.name} className="w-full max-h-[420px] object-contain bg-paper" />
                ) : (
                  <div className="w-full h-16 flex items-center gap-2 text-xs text-ink/50 p-3">
                    {a.type === "video" ? "🎬" : "📄"} {a.name}
                  </div>
                )}
                {!readOnly && (
                <button
                  onClick={() => handleRemoveAttachment(a.id)}
                  className="print:hidden absolute top-2 right-2 w-7 h-7 rounded-full bg-ink/80 text-white flex items-center justify-center text-sm hover:bg-coral"
                  title="Удалить"
                  aria-label="Удалить вложение"
                >
                  ✕
                </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      </div>

      {printPages && (
        <div className="hidden print:block">
          {printPages.map((p, i) => (
            <section key={p.id} className={i > 0 ? "break-before-page" : ""}>
              <h2 className="text-lg font-display font-700 mt-4 mb-2">{p.title}</h2>
              <div
                className="text-sm leading-relaxed"
                // Свой конспект — как есть, чужой (открытый другом) — после очистки, как и в редакторе
                dangerouslySetInnerHTML={{ __html: needsSanitize ? sanitizeNoteHtml(p.content) : p.content }}
              />
              {p.attachments
                .filter((a) => a.type === "image")
                .map((a) => (
                  <img key={a.id} src={a.url} alt={a.name} className="w-full max-h-[420px] object-contain mt-3" />
                ))}
            </section>
          ))}
        </div>
      )}

      {cardText !== null && notebook && (
        <CardFromSelectionModal
          selectedText={cardText}
          notebookTitle={notebook.title}
          onSaved={handleCardSaved}
          onClose={() => setCardText(null)}
        />
      )}
      {cardToast !== null && (
        <div
          role="status"
          className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-40 bg-ink text-white text-sm rounded-card px-4 py-2.5 shadow-lg flex items-center gap-3 print:hidden"
        >
          ✓ Карточка добавлена в «{cardToast}»
          <button onClick={() => navigate("/flashcards")} className="underline text-white/80 hover:text-white">
            Открыть
          </button>
        </div>
      )}

      {deletingPageId && (
        <ConfirmDialog
          title="Удалить страницу?"
          text={`«${pages.find((p) => p.id === deletingPageId)?.title ?? ""}» удалится вместе с текстом, картинками и файлами. Отменить это нельзя.`}
          onConfirm={() => handleDeletePage(deletingPageId)}
          onClose={() => setDeletingPageId(null)}
        />
      )}

      {shareOpen && (
        <FriendsShareModal
          title={notebook.title}
          target={{
            heading: "Поделиться тетрадью",
            hint: "отмеченные друзья смогут читать её в приложении, но не менять.",
            loadShared: () => getNotebookShares(notebook.id),
            share: (friendId) => shareNotebook(notebook.id, friendId),
            unshare: (friendId) => unshareNotebook(notebook.id, friendId),
            link: {
              load: () => getShareToken("notebooks", notebook.id),
              enable: () => enableShareLink("notebooks", notebook.id),
              disable: () => disableShareLink("notebooks", notebook.id),
              url: notebookLink,
              messageText: `Посмотри мой конспект «${notebook.title}» в приложении Lectiva`,
            },
          }}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}
