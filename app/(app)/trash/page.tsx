import Link from "next/link";
import { Icon } from "@/components/icons/Icon";
import { listEntries } from "@/lib/data/entries";
import { TrashView } from "@/components/trash/TrashView";

/**
 * The trash bin — every soft-deleted entry the user owns, with
 * "Восстановить" and "Удалить навсегда" affordances per row plus a
 * bulk-restore / bulk-purge bar.  Server-renders the initial list
 * for fast first paint; the client TrashView takes over for
 * mutations.
 */
export default async function TrashPage() {
  const { items } = await listEntries({ limit: 200, offset: 0 }, { trashed: true });

  return (
    <div className="fade-in">
      <section className="max-w-[1180px] mx-auto px-10 pt-12 pb-6 border-b border-white/10">
        <div className="flex items-center gap-3 mb-6 text-[12px] font-mono uppercase tracking-widest text-ivory-mute">
          <Link href="/" className="hover:text-gold">Главная</Link>
          <span>/</span>
          <span className="text-gold">Корзина</span>
        </div>

        <div className="flex items-end gap-7">
          <div className="text-emerald-200 flex-shrink-0">
            <Icon name="x" size={56} />
          </div>
          <div>
            <div className="font-mono text-[11px] uppercase tracking-widest text-gold mb-2">
              Trash · /trash
            </div>
            <h1 className="font-display text-[68px] font-light leading-[0.92] tracking-tightest">
              Корзина
            </h1>
            <p className="text-[14px] text-ivory-dim mt-3 max-w-2xl font-light">
              Удалённые записи лежат здесь.  Восстанови одним кликом или
              удали навсегда — после permanent delete вернуть нельзя.
            </p>
          </div>
        </div>
      </section>

      <TrashView initialItems={items} />
    </div>
  );
}
