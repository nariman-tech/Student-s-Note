import { Link } from "react-router-dom";
import { Notebook } from "../types";

// Карточка тетради — как настоящая тетрадь на полке: цветной корешок с прошивкой, обложка
// и обрез страниц справа. Это главный «характер» интерфейса, остальное вокруг нарочно спокойное.
// ownerUsername — для чужих тетрадей в разделе «Со мной поделились»
export default function NotebookCard({ notebook, ownerUsername }: { notebook: Notebook; ownerUsername?: string }) {
  return (
    <Link to={`/notebook/${notebook.id}`} className="group block focus-visible:outline-offset-4 rounded-r-card">
      <div className="relative transition-transform duration-200 ease-out group-hover:-translate-y-1 group-hover:-rotate-[0.6deg]">
        {/* Обрез страниц — два листа, чуть выглядывающих из-под обложки */}
        <div className="absolute inset-y-1.5 right-[-5px] left-3 rounded-r-card bg-white border border-line" aria-hidden />
        <div className="absolute inset-y-0.5 right-[-2.5px] left-3 rounded-r-card bg-[#FBFBFD] border border-line" aria-hidden />

        <div className="relative aspect-[4/5] rounded-r-card rounded-l-[4px] overflow-hidden shadow-lift">
          {notebook.coverImageUrl ? (
            <img src={notebook.coverImageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
          ) : (
            <div className="absolute inset-0" style={{ backgroundColor: notebook.spineColor }} aria-hidden>
              {/* Лёгкая фактура обложки: свет сверху и большая буква названия */}
              <div className="absolute inset-0 bg-gradient-to-br from-white/25 via-transparent to-black/10" />
              <span className="absolute right-3 bottom-1 font-display font-800 text-[5.5rem] leading-none text-white/25 select-none">
                {notebook.iconEmoji}
              </span>
            </div>
          )}

          {/* Корешок: затемнение и линия прошивки */}
          <div className="absolute inset-y-0 left-0 w-3.5 bg-black/20" aria-hidden />
          <div
            className="absolute inset-y-2 left-[18px] border-l border-dashed border-white/45"
            aria-hidden
          />

          {/* Этикетка с названием, как на обложке школьной тетради */}
          <div className="absolute left-5 right-2 top-3 sm:left-6 sm:right-3 sm:top-4 rounded-md bg-white/95 px-2.5 sm:px-3 py-2 sm:py-2.5 shadow-sm">
            <h3 className="font-display font-700 text-sm leading-snug line-clamp-3 hyphens-auto [overflow-wrap:anywhere]">{notebook.title}</h3>
            {notebook.courseTag && <p className="text-[11px] text-ink/50 mt-0.5 truncate">{notebook.courseTag}</p>}
          </div>
        </div>
      </div>
      <div className="mt-2.5 pl-1">
        {ownerUsername && <p className="text-xs text-lavender font-semibold">от @{ownerUsername}</p>}
        <p className="text-xs text-ink/45">Обновлено {formatDay(notebook.updatedAt)}</p>
      </div>
    </Link>
  );
}

// «2026-10-31» → «31 окт.»; с прошлых лет — с годом
function formatDay(isoDay: string): string {
  const d = new Date(isoDay);
  if (Number.isNaN(d.getTime())) return isoDay;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}
