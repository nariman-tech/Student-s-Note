// «Скачать PDF»: открываем системное окно печати, где можно выбрать «Сохранить как PDF».
// Так текст в PDF остаётся настоящим текстом (его можно выделять и искать), а не картинкой.
// Название документа на время печати меняем на название тетради — браузер предложит его как имя файла.
export function exportToPdf(fileTitle: string) {
  const previousTitle = document.title;
  document.title = fileTitle.replace(/[\/:*?"<>|]/g, " ").trim() || "Конспект";
  const restore = () => {
    document.title = previousTitle;
    window.removeEventListener("afterprint", restore);
  };
  window.addEventListener("afterprint", restore);
  window.print();
}
