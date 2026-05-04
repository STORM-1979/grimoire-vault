import Link from "next/link";
import { getCategory } from "@/lib/categories";
import { Icon } from "@/components/icons/Icon";
// Heavy @dnd-kit bundle is loaded on demand from a client wrapper.
import { KanbanBoardLazy as KanbanBoard } from "@/components/kanban/KanbanBoardLazy";

export default function KanbanPage() {
  const cat = getCategory("kanban")!;
  return (
    <div className="fade-in">
      <section className="max-w-[1480px] mx-auto px-10 pt-12 pb-8 border-b border-white/10">
        <div className="flex items-center gap-3 mb-6 text-[12px] font-mono uppercase tracking-widest text-ivory-mute">
          <Link href="/" className="hover:text-gold">Главная</Link>
          <span>/</span>
          <Link href="/categories" className="hover:text-gold">Категории</Link>
          <span>/</span>
          <span className="text-gold">№ 09 · Kanban</span>
        </div>
        <div className="flex items-end gap-7">
          <div className="text-emerald-200 flex-shrink-0"><Icon name={cat.icon} size={68} /></div>
          <div>
            <div className="font-mono text-[11px] uppercase tracking-widest text-gold mb-2">
              № 09 · Board · Drag &amp; drop ready
            </div>
            <h1 className="font-display text-[88px] font-light leading-[0.92] tracking-tightest">Kanban</h1>
            <div className="font-mono text-[12px] uppercase tracking-widest text-ivory-mute mt-2">
              Перетаскивай между колонками — изменения улетают в БД и синхронизируются realtime между устройствами
            </div>
          </div>
        </div>
      </section>

      <KanbanBoard />
    </div>
  );
}
