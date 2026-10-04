import { Link } from "react-router-dom";
import { Notebook } from "../types";

// ownerUsername — для чужих тетрадей в разделе «Со мной поделились»
export default function NotebookCard({ notebook, ownerUsername }: { notebook: Notebook; ownerUsername?: string }) {
  return (
    <Link
      to={`/notebook/${notebook.id}`}
      className="group flex rounded-card border border-line bg-card overflow-hidden hover:border-ink/30 transition-colors"
    >
      {/* Корешок тетради — цветная полоса вместо одинаковой тени у всех карточек */}
      <div className="w-2" style={{ backgroundColor: notebook.spineColor }} aria-hidden />
      <div className="flex-1">
        {notebook.coverImageUrl ? (
          <img src={notebook.coverImageUrl} alt="" className="w-full h-24 object-cover" />
        ) : (
          <div
            className="w-full h-24 flex items-center justify-center text-2xl font-display font-800 text-white"
            style={{ backgroundColor: notebook.spineColor }}
            aria-hidden
          >
            {notebook.iconEmoji}
          </div>
        )}
        <div className="p-4">
          <h3 className="font-display font-700 text-sm leading-snug mb-1">{notebook.title}</h3>
          {notebook.courseTag && <p className="text-xs text-ink/50 mb-2">{notebook.courseTag}</p>}
          {ownerUsername && <p className="text-xs text-lavender font-medium mb-1">от @{ownerUsername}</p>}
          <p className="text-xs text-ink/40">Обновлено {notebook.updatedAt}</p>
        </div>
      </div>
    </Link>
  );
}
